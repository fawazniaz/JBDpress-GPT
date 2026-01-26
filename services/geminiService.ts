/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

const LOCAL_REGISTRY_KEY = 'jbdpress_stores_v2'; // Bumped version for fresh state

/**
 * Delay helper
 */
async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Robustly fetches all RAG stores and merges with local memory to prevent "vanishing" repositories.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        
        if (!ai.fileSearchStores) {
            console.error("SDK fileSearchStores missing.");
            return JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
        }

        // 1. Get current local state (fallback)
        const localCache: TextbookModule[] = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
        const registryMap = new Map<string, TextbookModule>();
        localCache.forEach(m => registryMap.set(m.storeName, m));

        // 2. Attempt Cloud Fetch
        try {
            const response: any = await ai.fileSearchStores.list();
            const cloudStores = response.fileSearchStores || response.stores || (Array.isArray(response) ? response : []);

            for (const s of cloudStores) {
                // Fetch files for this store to ensure book list is fresh
                let bookList: string[] = [];
                try {
                    const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({
                        fileSearchStoreName: s.name
                    });
                    const files = filesRes.fileSearchStoreFiles || filesRes.files || (Array.isArray(filesRes) ? filesRes : []);
                    bookList = files.map((f: any) => f.displayName || 'Unnamed File');
                } catch (e) {
                    // Fallback to existing local book list if file fetch fails
                    bookList = registryMap.get(s.name)?.books || ['Syncing files...'];
                }

                registryMap.set(s.name, {
                    name: s.displayName || 'Untitled Module',
                    storeName: s.name,
                    books: Array.from(new Set(bookList)) // Deduplicate books
                });
            }
        } catch (cloudErr) {
            console.warn("Cloud Sync failed, using local cache only.", cloudErr);
        }

        const finalModules = Array.from(registryMap.values());
        
        // Save cleaned state
        if (finalModules.length > 0) {
            localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(finalModules));
        }
        
        return finalModules;
    } catch (err) {
        console.error("listAllModules Error:", err);
        return JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
    const storeName = ragStore.name || "";
    
    // Immediately add to local cache so it shows up
    const localCache: TextbookModule[] = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
    localCache.push({ name: displayName, storeName: storeName, books: ['Preparing cloud storage...'] });
    localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(localCache));
    
    return storeName;
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: ragStoreName,
        file: file
    });

    if (!op || !op.name) throw new Error("Upload failed.");
    
    let done = false;
    let attempts = 0;
    while (!done && attempts < 20) {
        await delay(5000);
        const currentOp: any = await ai.operations.get({ name: op.name });
        if (currentOp?.done) {
            if (currentOp.error) throw new Error(currentOp.error.message);
            done = true;
        }
        attempts++;
    }

    // Refresh local cache for this specific module
    const localCache: TextbookModule[] = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
    const idx = localCache.findIndex(m => m.storeName === ragStoreName);
    if (idx !== -1) {
        const existingBooks = localCache[idx].books.filter(b => !b.includes('...'));
        localCache[idx].books = Array.from(new Set([...existingBooks, file.name]));
        localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(localCache));
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
        text: response.text || "No response found in materials.",
        groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
    };
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: 'List 3 study questions based on these materials.',
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
        return ["What are the main topics discussed?", "Summarize the key takeaways.", "Explain the core concepts."];
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
