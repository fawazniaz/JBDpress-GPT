/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

// The definitive source of truth for the local repository
const STABLE_REGISTRY_KEY = 'JBDPRESS_STABLE_REGISTRY_FINAL';

/**
 * Migration & Recovery: Scans all previous storage attempts to ensure no data is left behind.
 */
function getLocalRepository(): TextbookModule[] {
    const legacyKeys = [
        'JBDPRESS_REPOSITORY_MASTER', 
        'jbdpress_stores_stable_v1', 
        'jbdpress_stores_v2', 
        'jbdpress_stores_v1', 
        'jbd_textbooks'
    ];
    
    const registryMap = new Map<string, TextbookModule>();
    
    // Load existing stable data
    const currentStable = JSON.parse(localStorage.getItem(STABLE_REGISTRY_KEY) || '[]');
    currentStable.forEach((m: TextbookModule) => {
        if (m && m.storeName) registryMap.set(m.storeName, m);
    });

    // Scavenge legacy keys for missing data
    legacyKeys.forEach(key => {
        try {
            const legacyData = JSON.parse(localStorage.getItem(key) || '[]');
            if (Array.isArray(legacyData)) {
                legacyData.forEach((m: any) => {
                    if (m && m.storeName && !registryMap.has(m.storeName)) {
                        registryMap.set(m.storeName, m);
                    }
                });
            }
        } catch (e) {}
    });

    const final = Array.from(registryMap.values());
    if (final.length > 0) {
        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(final));
    }
    return final;
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Robustly fetches all modules. Returns local data immediately while syncing cloud in background.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    const localData = getLocalRepository();
    const registryMap = new Map<string, TextbookModule>();
    localData.forEach(m => registryMap.set(m.storeName, m));

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        
        if (!ai.fileSearchStores) return localData;

        // Fetch cloud list with a reasonable timeout
        const cloudResponse: any = await Promise.race([
            ai.fileSearchStores.list(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000))
        ]).catch(() => ({ fileSearchStores: [] }));

        const cloudStores = cloudResponse.fileSearchStores || cloudResponse.stores || (Array.isArray(cloudResponse) ? cloudResponse : []);

        // Update local registry with cloud data (Additive only)
        for (const s of cloudStores) {
            try {
                const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({ 
                    fileSearchStoreName: s.name 
                }).catch(() => ({ fileSearchStoreFiles: [] }));
                
                const files = filesRes.fileSearchStoreFiles || filesRes.files || [];
                const bookNames = files.map((f: any) => f.displayName || 'Unnamed File');

                registryMap.set(s.name, {
                    name: s.displayName || 'Untitled Module',
                    storeName: s.name,
                    books: Array.from(new Set(bookNames))
                });
            } catch (e) {
                if (!registryMap.has(s.name)) {
                    registryMap.set(s.name, {
                        name: s.displayName || 'Untitled Module',
                        storeName: s.name,
                        books: ['Syncing content...']
                    });
                }
            }
        }

        const finalResults = Array.from(registryMap.values());
        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(finalResults));
        return finalResults;
    } catch (err) {
        console.error("Cloud Sync Interrupted - Using Local Master:", err);
        return localData;
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    
    const tempStoreName = `pending_${Date.now()}`;
    const local = getLocalRepository();
    local.push({ name: displayName, storeName: tempStoreName, books: ['Provisioning...'] });
    localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(local));

    try {
        const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
        const realName = ragStore.name || "";
        
        const updated = getLocalRepository().map(m => 
            m.storeName === tempStoreName ? { ...m, storeName: realName } : m
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
    
    const local = getLocalRepository();
    const idx = local.findIndex(m => m.storeName === ragStoreName);
    if (idx !== -1) {
        if (!local[idx].books.includes(file.name)) {
            local[idx].books.push(file.name);
            localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(local));
        }
    }

    const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: ragStoreName,
        file: file
    });

    if (!op || !op.name) throw new Error("Cloud upload rejected.");
    
    let attempts = 0;
    while (attempts < 25) {
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
        // Delete from cloud
        if (ai.fileSearchStores) {
            await ai.fileSearchStores.delete({ fileSearchStoreName: storeName });
        }
    } catch (e) {
        console.warn("Could not delete from cloud (it may already be gone), cleaning up local registry.", e);
    }
    
    // Cleanup local registry
    const local = getLocalRepository();
    const filtered = local.filter(m => m.storeName !== storeName);
    localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(filtered));
}

const BASE_GROUNDING_INSTRUCTION = `You are JBDPRESS_GPT, a strict RAG-based Textbook Tutor. 
CRITICAL RULE: Answer ONLY using the uploaded textbooks. Do not use outside knowledge.
If information is missing, say: "I apologize, but this is not in the textbooks."`;

export async function fileSearch(
    ragStoreName: string, 
    query: string, 
    method: string = 'standard',
    useFastMode: boolean = false,
    bookFocus?: string
): Promise<QueryResult> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    let instruction = BASE_GROUNDING_INSTRUCTION;
    if (bookFocus) { instruction += `\n\nFOCUS: Only search in: "${bookFocus}".`; }
    
    switch(method) {
        case 'blooms': instruction += " Apply Bloom's Taxonomy."; break;
        case 'montessori': instruction += " Use Montessori methods."; break;
        case 'pomodoro': instruction += " 25-minute study focus."; break;
        case 'kindergarten': instruction += " Simple analogies."; break;
        case 'lesson-plan': instruction += " Generate a Teacher's Lesson Plan."; break;
    }

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
            systemInstruction: instruction,
            tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
        }
    });

    return {
        text: response.text || "I found no relevant information in the textbooks.",
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
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch (err) {
        return ["What are the key concepts?", "Define the main terms.", "Summarize the material."];
    }
}

export async function connectLive(callbacks: {
    onopen: () => void;
    onmessage: (message: LiveServerMessage) => void;
    onerror: (e: any) => void;
    onclose: (e: any) => void;
}, method: string = 'standard'): Promise<any> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: BASE_GROUNDING_INSTRUCTION,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
            },
        },
    });
}

export function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

export async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}
