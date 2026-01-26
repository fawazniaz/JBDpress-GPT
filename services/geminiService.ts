/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

/**
 * Delay helper
 */
async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a promise with a timeout
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
    let timeoutId: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function handleApiError(err: any, context: string): Error {
    console.error(`Gemini API Error [${context}]:`, err);
    let message = err.message || "Unknown AI error";

    if (message.includes("Requested entity was not found.")) {
        return new Error("RESELECTION_REQUIRED: The selected API key was not found or is invalid for this project.");
    }

    if (err.status === 403 || message.includes("API key not valid")) {
        return new Error("INVALID_KEY: Your API key was rejected. Ensure you have a paid-tier key and billing enabled.");
    }

    if (err instanceof TypeError && (message.includes("fetch") || message.includes("NetworkError"))) {
        return new Error("NETWORK_ERROR: The connection was interrupted. Large files require a stable connection.");
    }
    
    return new Error(`${context} failed: ${message}`);
}

/**
 * Fetches all existing RAG stores from the cloud.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        
        if (!ai.fileSearchStores) {
            console.warn("RAG features unavailable on current SDK/Key.");
            return [];
        }

        // Fetch stores with a 30s timeout
        const storesResponse = (await withTimeout(
            ai.fileSearchStores.list(),
            30000,
            "Cloud sync timed out while fetching stores."
        )) as any;

        const modules: TextbookModule[] = [];
        
        // Robust detection of stores: check for fileSearchStores, stores, or direct array
        let stores: any[] = [];
        if (Array.isArray(storesResponse)) {
            stores = storesResponse;
        } else if (storesResponse && storesResponse.fileSearchStores) {
            stores = storesResponse.fileSearchStores;
        } else if (storesResponse && storesResponse.stores) {
            stores = storesResponse.stores;
        } else if (storesResponse && typeof (storesResponse as any)[Symbol.iterator] === 'function') {
            stores = Array.from(storesResponse as any);
        }
        
        if (stores.length === 0) {
            return [];
        }

        for (const store of stores) {
            try {
                const filesResponse = (await ai.fileSearchStores.listFilesSearchStoreFiles({
                    fileSearchStoreName: store.name!
                })) as any;
                
                // Robust detection of files
                let files: any[] = [];
                if (Array.isArray(filesResponse)) {
                    files = filesResponse;
                } else if (filesResponse && filesResponse.fileSearchStoreFiles) {
                    files = filesResponse.fileSearchStoreFiles;
                } else if (filesResponse && filesResponse.files) {
                    files = filesResponse.files;
                }

                modules.push({
                    name: store.displayName || 'Untitled Module',
                    storeName: store.name!,
                    books: files.map((f: any) => f.displayName || 'Unnamed File')
                });
            } catch (e) {
                console.warn(`Could not list files for store ${store.name}:`, e);
                // Still add the store name so the folder appears, even if books fail to list
                modules.push({
                    name: store.displayName || 'Untitled Module',
                    storeName: store.name!,
                    books: []
                });
            }
        }
        return modules;
    } catch (err: any) {
        throw handleApiError(err, "listAllModules");
    }
}

/**
 * Creates a new RAG store.
 */
export async function createRagStore(displayName: string): Promise<string> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        if (!ai.fileSearchStores) throw new Error("RAG stores are not supported by this API key or environment.");
        const ragStore = await ai.fileSearchStores.create({ config: { displayName } });
        return ragStore.name || "";
    } catch (err: any) {
        throw handleApiError(err, "createRagStore");
    }
}

/**
 * Uploads a file to a RAG store and polls until indexing is complete.
 */
export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    let op: any;

    try {
        op = await ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: file
        });
    } catch (err: any) {
        throw handleApiError(err, "Initial upload");
    }

    if (!op || !op.name) throw new Error("UPLOAD_FAILED: Cloud did not return an operation ID.");
    
    let retries = 0;
    const maxRetries = 180; // 15 minutes max wait (180 * 5s)
    
    while (retries < maxRetries) {
        await delay(5000); 
        try {
            const currentOp = await ai.operations.get({ name: op.name });
            if (currentOp) {
                op = currentOp;
                if (op.done) {
                    if (op.error) {
                        throw new Error(`Cloud indexing error: ${op.error.message}`);
                    }
                    return; // Indexing successfully complete
                }
            }
            retries++;
        } catch (pollErr: any) {
            console.warn("Polling operation status failed, retrying...", pollErr);
            retries++;
            // Don't kill the loop on a single polling error, cloud might be busy
            if (retries > 50 && pollErr.message.includes("404")) {
                 throw new Error("OPERATION_LOST: Cloud operation was lost. Check your library in a moment.");
            }
        }
    }
    
    throw new Error("INDEXING_TIMEOUT: The file is uploaded but the cloud is taking a long time to index. Check back in a few minutes.");
}

const BASE_GROUNDING_INSTRUCTION = `You are JBDPRESS_GPT, a strict RAG-based Textbook Tutor. 
CRITICAL RULE: Answer ONLY using the uploaded textbooks. Do not use outside knowledge.
If information is missing, say: "I apologize, but this is not in the textbooks."`;

/**
 * Performs a search against a RAG store.
 */
export async function fileSearch(
    ragStoreName: string, 
    query: string, 
    method: string = 'standard',
    useFastMode: boolean = false,
    bookFocus?: string
): Promise<QueryResult> {
    const model = 'gemini-3-pro-preview';
    let instruction = BASE_GROUNDING_INSTRUCTION;
    if (bookFocus) { instruction += `\n\nFOCUS: Only search in: "${bookFocus}".`; }
    
    switch(method) {
        case 'blooms': instruction += " Apply Bloom's Taxonomy."; break;
        case 'montessori': instruction += " Use Montessori methods."; break;
        case 'pomodoro': instruction += " 25-minute study focus."; break;
        case 'kindergarten': instruction += " Simple analogies."; break;
        case 'lesson-plan': instruction += " Generate a Teacher's Lesson Plan."; break;
    }

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: model,
            contents: query,
            config: {
                systemInstruction: instruction,
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
            }
        });

        return {
            text: response.text || "No relevant information found in the library.",
            groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
        };
    } catch (err: any) {
        throw handleApiError(err, "fileSearch");
    }
}

/**
 * Generates study questions based on textbooks.
 */
export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: 'List 3 study questions based on these textbooks.',
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
        return ["What are the key goals?", "Summarize the introduction.", "Explain the main theory."];
    }
}

/**
 * Connects to Gemini Live.
 */
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
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}

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
