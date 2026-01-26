/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

const LOCAL_REGISTRY_KEY = 'jbdpress_stores_v1';

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

    // Detect Quota/Rate Limit Errors (The error you saw)
    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
        return new Error("QUOTA_EXCEEDED: Your API key has reached its limit or doesn't have access to this specific model. Try switching to a Paid Key or wait a few minutes.");
    }

    if (message.includes("Requested entity was not found.")) {
        return new Error("RESELECTION_REQUIRED: The selected API key was not found or is invalid for this project.");
    }

    if (err.status === 403 || message.includes("API key not valid") || message.includes("PermissionDenied")) {
        return new Error("INVALID_KEY: Your API key was rejected. Ensure you have a paid-tier key and billing enabled.");
    }

    if (err instanceof TypeError && (message.includes("fetch") || message.includes("NetworkError"))) {
        return new Error("NETWORK_ERROR: The connection was interrupted. Check your internet connection.");
    }
    
    return new Error(`${context} failed: ${message}`);
}

/**
 * Fetches all existing RAG stores from the cloud AND merges with local registry for instant availability.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        
        if (!ai.fileSearchStores) {
            console.error("SDK Error: fileSearchStores property missing. Check environment/SDK version.");
            return [];
        }

        // Get cloud stores
        let cloudStores: any[] = [];
        try {
            const storesResponse = (await withTimeout(
                ai.fileSearchStores.list(),
                15000,
                "Cloud sync timed out."
            )) as any;

            if (Array.isArray(storesResponse)) {
                cloudStores = storesResponse;
            } else if (storesResponse?.fileSearchStores) {
                cloudStores = storesResponse.fileSearchStores;
            } else if (storesResponse?.stores) {
                cloudStores = storesResponse.stores;
            }
        } catch (e) {
            console.warn("Cloud list failed, falling back to local registry only.");
        }

        // Get local registry
        const localRegistry = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
        
        // Merge - prioritizing cloud data if available, keeping local as placeholder
        const mergedMap = new Map<string, TextbookModule>();
        
        // Add cloud stores
        for (const store of cloudStores) {
            if (!store.name) continue;
            mergedMap.set(store.name, {
                name: store.displayName || 'Untitled Module',
                storeName: store.name,
                books: []
            });
        }

        // Add local registry items if not already present
        for (const local of localRegistry) {
            if (!mergedMap.has(local.storeName)) {
                mergedMap.set(local.storeName, {
                    name: local.name,
                    storeName: local.storeName,
                    books: local.books || ['Indexing...']
                });
            }
        }

        const rawResults = Array.from(mergedMap.values());
        if (rawResults.length === 0) return [];

        // Enrich with file lists
        const enrichedPromises = rawResults.map(async (mod) => {
            try {
                const filesResponse = (await ai.fileSearchStores.listFilesSearchStoreFiles({
                    fileSearchStoreName: mod.storeName
                })) as any;
                
                let files: any[] = [];
                if (Array.isArray(filesResponse)) files = filesResponse;
                else if (filesResponse?.fileSearchStoreFiles) files = filesResponse.fileSearchStoreFiles;
                else if (filesResponse?.files) files = filesResponse.files;

                return {
                    ...mod,
                    books: files.length > 0 ? files.map((f: any) => f.displayName || 'Unnamed File') : mod.books
                };
            } catch (e) {
                return mod; 
            }
        });

        return await Promise.all(enrichedPromises);
    } catch (err: any) {
        throw handleApiError(err, "listAllModules");
    }
}

/**
 * Creates a new RAG store and registers it locally.
 */
export async function createRagStore(displayName: string): Promise<string> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        const ragStore = await ai.fileSearchStores.create({ config: { displayName } });
        const storeName = ragStore.name || "";
        
        const registry = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
        registry.push({ name: displayName, storeName: storeName, books: ['Connecting to cloud...'] });
        localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(registry));
        
        return storeName;
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
    const maxRetries = 40; 
    
    while (retries < maxRetries) {
        await delay(5000); 
        try {
            const pollAi = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
            const currentOp = await pollAi.operations.get({ name: op.name });
            if (currentOp) {
                op = currentOp;
                if (op.done) {
                    if (op.error) throw new Error(`Indexing Error: ${op.error.message}`);
                    
                    const registry = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
                    const idx = registry.findIndex((r: any) => r.storeName === ragStoreName);
                    if (idx !== -1) {
                        if (!Array.isArray(registry[idx].books)) registry[idx].books = [];
                        registry[idx].books = registry[idx].books.filter((b: string) => b.includes('...'));
                        registry[idx].books.push(file.name);
                        localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(registry));
                    }
                    return; 
                }
            }
            retries++;
        } catch (pollErr: any) {
            retries++;
        }
    }
    
    throw new Error("INDEXING_TIMEOUT: The file is uploaded. It will appear in your library automatically within 5 minutes as the cloud finishes indexing.");
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // CHANGED: Use gemini-3-flash-preview instead of pro to bypass 429 quota limits on free keys
    const model = 'gemini-3-flash-preview'; 
    
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
