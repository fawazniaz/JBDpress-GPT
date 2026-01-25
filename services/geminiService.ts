/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

/**
 * Creates a new instance of the Google GenAI SDK.
 * Using 'any' return type to allow access to non-standard or undocumented properties like 'fileSearchStores'.
 */
function getAI(): any {
    const key = process.env.API_KEY;
    if (!key || key === '' || key === 'undefined') {
        throw new Error("API_KEY_NOT_FOUND_IN_BUNDLE");
    }
    return new GoogleGenAI({ apiKey: key });
}

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
    let message = err.message || "Unknown API error";

    if (err instanceof TypeError && (message.includes("fetch") || message.includes("NetworkError"))) {
        return new Error("NETWORK_CONNECTION_ERROR: Connection lost. Large files (50MB) are sensitive to Wi-Fi drops. Please try a more stable connection.");
    }

    if (message === "API_KEY_NOT_FOUND_IN_BUNDLE") {
        return new Error("MISSING_KEY_ERROR: The API key is not configured in the Vercel deployment.");
    }
    
    if (message.includes("API key not valid") || message.includes("400")) {
        message = "INVALID_KEY: The API key was rejected. Ensure the LATEST version is deployed on Vercel.";
    }
    
    return new Error(message);
}

/**
 * Fetches all existing RAG stores and their file contents from the cloud.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    try {
        const ai = getAI();
        // Set a 20-second timeout for the initial listing to prevent UI hanging
        // Property access on 'ai' is now safe because 'getAI()' returns 'any'
        const storesResponse = await withTimeout(
            ai.fileSearchStores.list(),
            20000,
            "SYNC_TIMEOUT: Cloud repository is taking too long to respond."
        );

        const modules: TextbookModule[] = [];

        if (storesResponse.fileSearchStores) {
            for (const store of storesResponse.fileSearchStores) {
                try {
                    const filesResponse = await ai.fileSearchStores.listFilesSearchStoreFiles({
                        fileSearchStoreName: store.name!
                    });
                    
                    modules.push({
                        name: store.displayName || 'Untitled Module',
                        storeName: store.name!,
                        books: (filesResponse.fileSearchStoreFiles || []).map(f => f.displayName || 'Unnamed File')
                    });
                } catch (e) {
                    console.warn(`Could not fetch files for store ${store.name}, skipping metadata.`);
                    modules.push({
                        name: store.displayName || 'Untitled Module',
                        storeName: store.name!,
                        books: []
                    });
                }
            }
        }
        return modules;
    } catch (err: any) {
        throw handleApiError(err, "listAllModules");
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    try {
        const ai = getAI();
        const ragStore = await ai.fileSearchStores.create({ config: { displayName } });
        return ragStore.name || "";
    } catch (err: any) {
        throw handleApiError(err, "createRagStore");
    }
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = getAI();
    let op;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            op = await ai.fileSearchStores.uploadToFileSearchStore({
                fileSearchStoreName: ragStoreName,
                file: file
            });
            break; 
        } catch (err: any) {
            attempts++;
            if (attempts < maxAttempts) {
                await delay(3000);
                continue;
            }
            throw handleApiError(err, "uploadToRagStore");
        }
    }

    if (!op) throw new Error("UPLOAD_FAILED: Connection could not be established.");
    
    let retries = 0;
    const maxRetries = 150; // ~10 minutes
    
    while (!op.done && retries < maxRetries) {
        await delay(5000); // 5s poll interval is safer for large files
        try {
            op = await ai.operations.get({ operation: op });
            retries++;
        } catch (pollErr: any) {
            // If polling fails, don't crash, just try again next cycle
            console.warn("Polling operation status failed, retrying...", pollErr);
            retries++;
            continue;
        }
    }
    
    if (retries >= maxRetries && !op.done) {
        throw new Error("INDEXING_TIMEOUT: This book is taking very long to index. It may still appear in the library in a few minutes. Please split PDFs over 30MB.");
    }
    
    if (op.error) {
        throw new Error(`AI_READ_ERROR: ${op.error.message}`);
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
        const ai = getAI();
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: model,
            contents: query,
            config: {
                systemInstruction: instruction,
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } }]
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

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: 'List 3 study questions based on these textbooks.',
            config: {
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } }],
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

export async function connectLive(callbacks: {
    onopen: () => void;
    onmessage: (message: LiveServerMessage) => void;
    onerror: (e: any) => void;
    onclose: (e: any) => void;
}, method: string = 'standard'): Promise<any> {
    const ai = getAI();
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
