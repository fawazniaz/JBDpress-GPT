/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

// The definitive source of truth for local data
const MASTER_KEY = 'JBDPRESS_REPOSITORY_MASTER';

/**
 * Migration helper to recover data from older versions
 */
function migrateLegacyData(): TextbookModule[] {
    const keys = ['jbdpress_stores_v1', 'jbdpress_stores_v2', 'jbdpress_stores_stable_v1', 'jbd_textbooks'];
    const registryMap = new Map<string, TextbookModule>();
    
    // Load existing master data first
    const master = JSON.parse(localStorage.getItem(MASTER_KEY) || '[]');
    master.forEach((m: TextbookModule) => registryMap.set(m.storeName, m));

    // Scrape legacy keys
    keys.forEach(key => {
        try {
            const data = JSON.parse(localStorage.getItem(key) || '[]');
            if (Array.isArray(data)) {
                data.forEach((m: any) => {
                    if (m && m.storeName && !registryMap.has(m.storeName)) {
                        registryMap.set(m.storeName, m);
                    }
                });
            }
        } catch (e) {}
    });

    const final = Array.from(registryMap.values());
    if (final.length > 0) {
        localStorage.setItem(MASTER_KEY, JSON.stringify(final));
    }
    return final;
}

/**
 * Delay helper
 */
async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timeout wrapper for promises
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
    ]);
}

/**
 * Robustly fetches all RAG stores with fallback to master registry.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    // 1. Start with migrated local data for instant response
    const currentRegistry = migrateLegacyData();
    const registryMap = new Map<string, TextbookModule>();
    currentRegistry.forEach(m => registryMap.set(m.storeName, m));

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        
        if (!ai.fileSearchStores) {
            return currentRegistry;
        }

        // 2. Fetch fresh metadata from Cloud with a timeout to prevent hanging
        const response: any = await withTimeout(ai.fileSearchStores.list(), 8000, { fileSearchStores: [] });
        const cloudStores = response.fileSearchStores || response.stores || (Array.isArray(response) ? response : []);

        if (cloudStores.length === 0) {
            return currentRegistry;
        }

        // 3. Process Cloud Stores in Parallel
        const updatedModules = await Promise.all(cloudStores.map(async (s: any) => {
            try {
                // Try fetching files with a strict 5s timeout
                const filesRes: any = await withTimeout(
                    ai.fileSearchStores.listFilesSearchStoreFiles({ fileSearchStoreName: s.name }),
                    5000,
                    { fileSearchStoreFiles: [] }
                );
                
                const files = filesRes.fileSearchStoreFiles || filesRes.files || (Array.isArray(filesRes) ? filesRes : []);
                const bookNames = files.map((f: any) => f.displayName || 'Unnamed File');
                
                return {
                    name: s.displayName || 'Untitled Module',
                    storeName: s.name,
                    books: Array.from(new Set(bookNames))
                };
            } catch (e) {
                // Use existing data if cloud check fails
                return registryMap.get(s.name) || {
                    name: s.displayName || 'Untitled Module',
                    storeName: s.name,
                    books: ['Syncing...']
                };
            }
        }));

        // 4. Update the Registry Map (Cloud data updates existing entries)
        updatedModules.forEach(m => {
            const existing = registryMap.get(m.storeName);
            // If the cloud version has zero books but local has some, keep local list (likely a sync lag)
            if (m.books.length === 0 && existing && existing.books.length > 0) {
                registryMap.set(m.storeName, { ...m, books: existing.books });
            } else {
                registryMap.set(m.storeName, m);
            }
        });
        
        const finalResults = Array.from(registryMap.values());
        localStorage.setItem(MASTER_KEY, JSON.stringify(finalResults));
        return finalResults;
    } catch (err) {
        console.error("Cloud Sync Error:", err);
        return currentRegistry;
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
    const storeName = ragStore.name || "";
    
    // Instant local update
    const current = JSON.parse(localStorage.getItem(MASTER_KEY) || '[]');
    current.push({ name: displayName, storeName, books: ['Preparing Store...'] });
    localStorage.setItem(MASTER_KEY, JSON.stringify(current));
    
    return storeName;
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: ragStoreName,
        file: file
    });

    if (!op || !op.name) throw new Error("Upload initialization failed.");
    
    // Polling with capped attempts
    let attempts = 0;
    while (attempts < 20) {
        await delay(4000);
        const currentOp: any = await ai.operations.get({ name: op.name });
        if (currentOp?.done) {
            if (currentOp.error) throw new Error(currentOp.error.message);
            break;
        }
        attempts++;
    }

    // Immediate optimistic local update
    const current = JSON.parse(localStorage.getItem(MASTER_KEY) || '[]');
    const idx = current.findIndex((m: any) => m.storeName === ragStoreName);
    if (idx !== -1) {
        const books = current[idx].books.filter((b: string) => !b.includes('...'));
        if (!books.includes(file.name)) {
            current[idx].books = Array.from(new Set([...books, file.name]));
            localStorage.setItem(MASTER_KEY, JSON.stringify(current));
        }
    }
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
        return ["What are the primary objectives?", "Define key terms.", "Summarize this module."];
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
