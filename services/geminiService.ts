
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality } from "@google/genai";
import { QueryResult, TextbookModule, CloudFile } from '../types';

const STABLE_REGISTRY_KEY = 'JBDPRESS_STABLE_REGISTRY_FINAL';

function getLocalRepository(): TextbookModule[] {
    try {
        const data = JSON.parse(localStorage.getItem(STABLE_REGISTRY_KEY) || '[]');
        return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exhaustively fetches all raw files in the project, handling pagination.
 */
export async function listAllCloudFiles(): Promise<CloudFile[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    if (!ai.files) return [];
    
    let allFiles: CloudFile[] = [];
    let pageToken: string | undefined = undefined;
    
    try {
        do {
            const res: any = await ai.files.list({ pageToken, pageSize: 100 });
            if (res.files) {
                allFiles = [...allFiles, ...res.files];
            }
            pageToken = res.nextPageToken;
        } while (pageToken);
        
        return allFiles;
    } catch (e) {
        console.error("Failed to list raw files:", e);
        return [];
    }
}

export async function deleteRawFile(fileName: string): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    if (!ai.files) return;
    await ai.files.delete({ name: fileName });
}

/**
 * Exhaustively fetches all modules (RAG Stores), handling pagination.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    const localData = getLocalRepository();
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    if (!ai.fileSearchStores) return localData;

    let allStores: any[] = [];
    let pageToken: string | undefined = undefined;

    try {
        // 1. Fetch all stores across all pages
        do {
            const cloudResponse: any = await ai.fileSearchStores.list({ pageToken, pageSize: 50 });
            const stores = cloudResponse.fileSearchStores || cloudResponse.stores || [];
            allStores = [...allStores, ...stores];
            pageToken = cloudResponse.nextPageToken;
        } while (pageToken);

        // 2. Fetch details for each store
        const storeDetailPromises = allStores.map(async (s: any) => {
            try {
                const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({ 
                    fileSearchStoreName: s.name 
                });
                const files = filesRes.fileSearchStoreFiles || filesRes.files || [];
                return {
                    name: s.displayName || s.name.split('/').pop(),
                    storeName: s.name,
                    books: files.map((f: any) => f.displayName || f.name)
                };
            } catch (e) {
                return { name: s.displayName || s.name, storeName: s.name, books: [] };
            }
        });

        const results = await Promise.all(storeDetailPromises);
        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(results));
        return results;
    } catch (err) {
        console.warn("Module Sync Interrupted:", err);
        return localData;
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
    return ragStore.name;
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: ragStoreName,
        file: file
    });
    
    let attempts = 0;
    while (attempts < 40) {
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
    const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({ fileSearchStoreName: storeName });
    const files = filesRes.fileSearchStoreFiles || filesRes.files || [];
    const fileToDelete = files.find((f: any) => f.displayName === fileName || f.name.includes(fileName));
    if (fileToDelete) {
        await ai.fileSearchStores.deleteFileSearchStoreFile({ fileSearchStoreFileName: fileToDelete.name });
    }
}

export async function fileSearch(ragStoreName: string, query: string, method: string = 'standard', useFastMode: boolean = false, bookFocus?: string): Promise<QueryResult> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
            systemInstruction: `You are a textbook tutor. Only use uploaded material. Method: ${method}`,
            tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
        }
    });
    return {
        text: response.text || "No relevant data found in textbooks.",
        groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
    };
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: 'Suggest 3 textbook questions.',
            config: {
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any],
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch { return ["Analyze the core concepts."]; }
}

export async function connectLive(callbacks: any, method: string = 'standard'): Promise<any> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            systemInstruction: `You are a textbook tutor using ${method} style.`,
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
