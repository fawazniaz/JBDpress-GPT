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

/**
 * Robust retry wrapper for transient API errors (503, 500)
 */
async function withRetry<T>(fn: (retryCount: number) => Promise<T>, maxRetries = 4): Promise<T> {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn(i);
        } catch (err: any) {
            lastError = err;
            const isTransient = err.message?.includes("503") || 
                               err.message?.includes("500") || 
                               err.message?.includes("overloaded") ||
                               err.message?.includes("UNAVAILABLE") ||
                               err.message?.includes("deadline");
            
            if (isTransient && i < maxRetries - 1) {
                const backoff = Math.pow(2, i) * 3000; 
                console.warn(`Transient Error. Retry ${i+1}/${maxRetries} in ${backoff}ms...`, err);
                await delay(backoff);
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

function handleApiError(err: any, context: string): Error {
    console.error(`Gemini API Error [${context}]:`, err);
    let message = err.message || "Unknown AI error";

    if (message.includes("503") || message.includes("overloaded") || message.includes("UNAVAILABLE")) {
        return new Error("SERVER_OVERLOADED: The AI service is under extreme heavy load. Please wait 20 seconds and refresh.");
    }

    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
        return new Error("QUOTA_EXCEEDED: API limit reached. Please wait 1 minute.");
    }

    if (message.includes("Requested entity was not found.")) {
        return new Error("RESELECTION_REQUIRED: Session expired. Please re-select your API key.");
    }

    return new Error(`${context} failed: ${message}`);
}

/**
 * Robustly fetches all RAG stores and ensures NO duplicates.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    return withRetry(async () => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
            
            if (!ai.fileSearchStores) {
                console.error("Critical: SDK fileSearchStores missing.");
                return [];
            }

            let cloudStores: any[] = [];
            try {
                const response: any = await withTimeout(
                    ai.fileSearchStores.list(),
                    25000,
                    "Cloud list timed out."
                );

                if (Array.isArray(response)) cloudStores = response;
                else if (response?.fileSearchStores) cloudStores = response.fileSearchStores;
                else if (response?.stores) cloudStores = response.stores;
            } catch (e: any) {
                console.warn("Cloud list request failed. Falling back to local cache.");
            }

            const localRegistry: TextbookModule[] = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
            const mergedMap = new Map<string, TextbookModule>();
            
            // 1. Process Cloud Stores First (Source of Truth)
            for (const store of cloudStores) {
                if (!store.name) continue;
                mergedMap.set(store.name, {
                    name: store.displayName || 'Untitled Module',
                    storeName: store.name,
                    books: []
                });
            }

            // 2. Merge Local Cache (Only if missing from cloud)
            for (const local of localRegistry) {
                if (!mergedMap.has(local.storeName)) {
                    mergedMap.set(local.storeName, {
                        name: local.name,
                        storeName: local.storeName,
                        books: Array.from(new Set(local.books || [])) // Internal book deduplication
                    });
                }
            }

            const rawResults = Array.from(mergedMap.values());
            
            // 3. Deep Sync Books per Store
            const enrichedPromises = rawResults.map(async (mod) => {
                try {
                    const filesResponse: any = await ai.fileSearchStores.listFilesSearchStoreFiles({
                        fileSearchStoreName: mod.storeName
                    });
                    
                    let files: any[] = [];
                    if (Array.isArray(filesResponse)) files = filesResponse;
                    else if (filesResponse?.fileSearchStoreFiles) files = filesResponse.fileSearchStoreFiles;
                    else if (filesResponse?.files) files = filesResponse.files;

                    // Strictly unique file names
                    const bookNames = files.map((f: any) => f.displayName || 'Unnamed File');
                    const uniqueBooks = Array.from(new Set([...bookNames, ...mod.books]))
                                           .filter(b => b && !b.includes('...')); // Remove placeholder status items

                    return {
                        ...mod,
                        books: uniqueBooks.length > 0 ? uniqueBooks : ['No files found']
                    };
                } catch (e) {
                    return mod; 
                }
            });

            const finalResults = await Promise.all(enrichedPromises);
            
            // Save cleaned state
            localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(finalResults));
            return finalResults;
        } catch (err: any) {
            throw handleApiError(err, "listAllModules");
        }
    });
}

export async function createRagStore(displayName: string): Promise<string> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
        const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
        const storeName = ragStore.name || "";
        
        const registry = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
        // Ensure we don't add a duplicate entry to local registry
        if (!registry.some((r: any) => r.storeName === storeName)) {
            registry.push({ name: displayName, storeName: storeName, books: ['New Module Created...'] });
            localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(registry));
        }
        
        return storeName;
    } catch (err: any) {
        throw handleApiError(err, "createRagStore");
    }
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
    let op: any;

    try {
        op = await ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: file
        });
    } catch (err: any) {
        throw handleApiError(err, "Upload request");
    }

    if (!op || !op.name) throw new Error("Cloud upload rejected.");
    
    let retries = 0;
    const maxRetries = 30; 
    
    while (retries < maxRetries) {
        await delay(6000); 
        try {
            const pollAi = new GoogleGenAI({ apiKey: process.env.API_KEY }) as any;
            const currentOp: any = await pollAi.operations.get({ name: op.name });
            if (currentOp?.done) {
                if (currentOp.error) throw new Error(`Indexing error: ${currentOp.error.message}`);
                
                // Update local registry with unique books
                const registry: TextbookModule[] = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || '[]');
                const idx = registry.findIndex(r => r.storeName === ragStoreName);
                if (idx !== -1) {
                    const currentBooks = registry[idx].books.filter(b => !b.includes('...'));
                    if (!currentBooks.includes(file.name)) {
                        registry[idx].books = Array.from(new Set([...currentBooks, file.name]));
                        localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(registry));
                    }
                }
                return; 
            }
            retries++;
        } catch (pollErr: any) {
            retries++;
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
    return withRetry(async (retryCount) => {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const model = retryCount === 0 ? 'gemini-3-flash-preview' : 'gemini-flash-lite-latest';
        
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
                text: response.text || "No direct answer found in the textbooks.",
                groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
            };
        } catch (err: any) {
            throw handleApiError(err, `fileSearch`);
        }
    });
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    return withRetry(async () => {
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
            const q = JSON.parse(response.text || "[]");
            return Array.from(new Set(q)); // Deduplicate questions
        } catch (err) {
            return ["What are the key goals?", "Summarize the introduction.", "Explain the main theory."];
        }
    });
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
