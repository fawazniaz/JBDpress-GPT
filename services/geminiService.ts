
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

const STABLE_REGISTRY_KEY = 'JBDPRESS_STABLE_REGISTRY_FINAL';

function getLocalRepository(): TextbookModule[] {
    const registryMap = new Map<string, TextbookModule>();
    try {
        const currentStable = JSON.parse(localStorage.getItem(STABLE_REGISTRY_KEY) || '[]');
        currentStable.forEach((m: TextbookModule) => {
            if (m && m.storeName) registryMap.set(m.storeName, m);
        });
    } catch (e) {}
    return Array.from(registryMap.values());
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listAllModules(): Promise<TextbookModule[]> {
    const localData = getLocalRepository();
    const registryMap = new Map<string, TextbookModule>();
    localData.forEach(m => registryMap.set(m.storeName, m));

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        if (!ai.fileSearchStores) return localData;

        // More generous timeout for deep sync
        const cloudResponse: any = await Promise.race([
            ai.fileSearchStores.list(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 12000))
        ]).catch(() => ({ fileSearchStores: [] }));

        const cloudStores = cloudResponse.fileSearchStores || cloudResponse.stores || (Array.isArray(cloudResponse) ? cloudResponse : []);

        const storeDetailPromises = cloudStores.map(async (s: any) => {
            try {
                const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({ 
                    fileSearchStoreName: s.name 
                }).catch(() => ({ fileSearchStoreFiles: [] }));
                
                const files = filesRes.fileSearchStoreFiles || filesRes.files || [];
                const bookNames = files.map((f: any) => f.displayName || f.name || 'Unnamed File');

                return {
                    name: s.displayName || s.name.split('/').pop() || 'Unnamed Module',
                    storeName: s.name,
                    books: Array.from(new Set(bookNames))
                };
            } catch (e) {
                return registryMap.get(s.name) || {
                    name: s.displayName || 'Untitled Module',
                    storeName: s.name,
                    books: ['Sync error - Cache only']
                };
            }
        });

        const cloudResults = await Promise.all(storeDetailPromises);
        cloudResults.forEach(res => {
            if (res && res.storeName) registryMap.set(res.storeName, res);
        });

        const finalResults = Array.from(registryMap.values());
        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(finalResults));
        return finalResults;
    } catch (err) {
        console.warn("Cloud Sync Limited:", err);
        return localData;
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const tempStoreName = `pending_${Date.now()}`;
    const local = getLocalRepository();
    local.push({ name: displayName, storeName: tempStoreName, books: ['Creating...'] });
    localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(local));

    try {
        const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
        const realName = ragStore.name || "";
        const updated = getLocalRepository().map(m => 
            m.storeName === tempStoreName ? { ...m, storeName: realName, books: [] } : m
        );
        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(updated));
        return realName;
    } catch (err) {
        const rolledBack = getLocalRepository().filter(m => m.storeName !== tempStoreName);
        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(rolledBack));
        throw err;
    }
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: ragStoreName,
        file: file
    });

    if (!op || !op.name) throw new Error("Upload failed to start.");
    
    let attempts = 0;
    while (attempts < 30) {
        await delay(3000);
        const currentOp: any = await ai.operations.get({ name: op.name });
        if (currentOp?.done) {
            if (currentOp.error) throw new Error(currentOp.error.message);
            break;
        }
        attempts++;
    }
}

export async function deleteRagStore(storeName: string): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    try {
        await ai.fileSearchStores.delete({ fileSearchStoreName: storeName });
    } catch (e) {}
    const local = getLocalRepository().filter(m => m.storeName !== storeName);
    localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(local));
}

export async function deleteFileFromStore(storeName: string, fileName: string): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    try {
        // Find the file reference first
        const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({ 
            fileSearchStoreName: storeName 
        });
        const files = filesRes.fileSearchStoreFiles || filesRes.files || [];
        const fileToDelete = files.find((f: any) => f.displayName === fileName || f.name.includes(fileName));
        
        if (fileToDelete) {
            await ai.fileSearchStores.deleteFileSearchStoreFile({ 
                fileSearchStoreFileName: fileToDelete.name 
            });
        }
    } catch (e) {
        throw new Error(`Failed to delete cloud file: ${e.message}`);
    }
}

const BASE_GROUNDING_INSTRUCTION = `You are JBDPRESS_GPT, a strict RAG-based Textbook Tutor. 
Answer ONLY using the uploaded textbooks. Do not use outside knowledge.`;

export async function fileSearch(ragStoreName: string, query: string, method: string = 'standard', useFastMode: boolean = false, bookFocus?: string): Promise<QueryResult> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    let instruction = BASE_GROUNDING_INSTRUCTION;
    if (bookFocus) { instruction += `\nFOCUS: Only use: "${bookFocus}".`; }
    
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
            systemInstruction: instruction,
            tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
        }
    });

    return {
        text: response.text || "I apologize, but this is not in the textbooks.",
        groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
    };
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: 'Suggest 3 study questions.',
            config: {
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any],
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch (err) {
        return ["What are the key concepts?"];
    }
}

export async function connectLive(callbacks: any, method: string = 'standard'): Promise<any> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: BASE_GROUNDING_INSTRUCTION,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
        }
    });
}

export const encodeBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const decodeBase64 = (s: string) => new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0)));
export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
    return buffer;
}
