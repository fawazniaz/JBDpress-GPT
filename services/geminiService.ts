/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

// Using a unified key to ensure data persistence across versions
const LOCAL_REGISTRY_KEY = 'jbdpress_stores_stable_v1';

/**
 * Delay helper
 */
async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Robustly fetches all RAG stores and ensures the UI always has data to show.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    // 1. Immediately get what we have in local storage for instant UI response
    const v1Cache = JSON.parse(localStorage.getItem('jbdpress_stores_v1') || '[]');
    const v2Cache = JSON.parse(localStorage.getItem('jbdpress_stores_v2') || '[]');
    const stableCache = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
    
    // Merge all possible caches to recover "lost" data
    const initialList = [...stableCache, ...v2Cache, ...v1Cache];
    const registryMap = new Map<string, TextbookModule>();
    initialList.forEach(m => {
        if (m.storeName) registryMap.set(m.storeName, m);
    });

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        
        // Check if the SDK supports the fileSearchStores property
        if (!ai.fileSearchStores) {
            console.warn("SDK fileSearchStores missing. Operating in cache-only mode.");
            return Array.from(registryMap.values());
        }

        // 2. Fetch fresh data from Cloud
        const response: any = await ai.fileSearchStores.list();
        const cloudStores = response.fileSearchStores || response.stores || (Array.isArray(response) ? response : []);

        if (cloudStores.length === 0 && registryMap.size > 0) {
            // If cloud is empty but local has data, trust local (maybe cloud is just slow/syncing)
            return Array.from(registryMap.values());
        }

        // 3. Process Cloud Stores in Parallel for speed
        const updatedModules = await Promise.all(cloudStores.map(async (s: any) => {
            try {
                // Fetch files for this specific store
                const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({
                    fileSearchStoreName: s.name
                });
                const files = filesRes.fileSearchStoreFiles || filesRes.files || (Array.isArray(filesRes) ? filesRes : []);
                const bookNames = files.map((f: any) => f.displayName || 'Unnamed File');
                
                return {
                    name: s.displayName || 'Untitled Module',
                    storeName: s.name,
                    books: Array.from(new Set(bookNames))
                };
            } catch (e) {
                // On individual store fetch error, try to use what we had in cache
                return registryMap.get(s.name) || {
                    name: s.displayName || 'Untitled Module',
                    storeName: s.name,
                    books: ['Synchronizing...']
                };
            }
        }));

        // 4. Update the Registry Map with fresh cloud data
        updatedModules.forEach(m => registryMap.set(m.storeName, m));
        
        const finalResults = Array.from(registryMap.values());
        
        // Save cleaned state to the stable key
        if (finalResults.length > 0) {
            localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(finalResults));
        }
        
        return finalResults;
    } catch (err) {
        console.error("Cloud listAllModules Sync Error:", err);
        // On total cloud failure, return whatever we have in local cache
        return Array.from(registryMap.values());
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
    const storeName = ragStore.name || "";
    
    // Instant update local cache
    const current = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
    current.push({ name: displayName, storeName, books: ['Creating...'] });
    localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(current));
    
    return storeName;
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: ragStoreName,
        file: file
    });

    if (!op || !op.name) throw new Error("Upload initialization failed.");
    
    let attempts = 0;
    while (attempts < 30) {
        await delay(4000);
        const currentOp: any = await ai.operations.get({ name: op.name });
        if (currentOp?.done) {
            if (currentOp.error) throw new Error(currentOp.error.message);
            break;
        }
        attempts++;
    }

    // Update specific module in cache immediately
    const current = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
    const idx = current.findIndex((m: any) => m.storeName === ragStoreName);
    if (idx !== -1) {
        const books = current[idx].books.filter((b: string) => !b.includes('...'));
        if (!books.includes(file.name)) {
            current[idx].books = Array.from(new Set([...books, file.name]));
            localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(current));
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
        text: response.text || "I found no relevant information in the textbooks for your query.",
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
        return ["What are the primary objectives of this chapter?", "Define the key terminology used here.", "How does this concept apply to real-world scenarios?"];
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
