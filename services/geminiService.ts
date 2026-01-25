/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult, TextbookModule } from '../types';

/**
 * Creates a new instance of the Google GenAI SDK.
 * Always returns a fresh instance to ensure the most up-to-date API key is used right before calls.
 */
function getAI(): any {
    const key = process.env.API_KEY;
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
    let message = err.message || "Unknown AI error";

    if (message.includes("Requested entity was not found.")) {
        if (typeof window !== 'undefined' && window.aistudio?.openSelectKey) {
            window.aistudio.openSelectKey();
        }
        return new Error("RESELECTION_REQUIRED: The selected API key was not found. Please re-select your key.");
    }

    if (err.status === 403 || message.includes("API key not valid")) {
        return new Error("INVALID_KEY: Your API key was rejected. Double-check your Vercel/AI Studio settings.");
    }

    if (err instanceof TypeError && (message.includes("fetch") || message.includes("NetworkError"))) {
        return new Error("NETWORK_ERROR: Connection lost. Large files are sensitive to Wi-Fi interruptions.");
    }

    if (message.includes("undefined") && context.includes("fileSearchStores")) {
        return new Error("SDK_INCOMPATIBILITY: RAG features are not supported in this environment.");
    }
    
    return new Error(`${context} failed: ${message}`);
}

/**
 * Fetches all existing RAG stores from the cloud.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    try {
        const ai = getAI() as any;
        if (!ai.fileSearchStores) throw new Error("RAG_NOT_SUPPORTED");

        const storesResponse = await withTimeout(
            ai.fileSearchStores.list(),
            20000,
            "Cloud sync timed out."
        ) as any;

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
                        books: (filesResponse.fileSearchStoreFiles || []).map((f: any) => f.displayName || 'Unnamed File')
                    });
                } catch (e) {
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
        if (err.message === "RAG_NOT_SUPPORTED") return [];
        throw handleApiError(err, "listAllModules");
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    try {
        const ai = getAI() as any;
        if (!ai.fileSearchStores) throw new Error("RAG stores not supported.");
        const ragStore = await ai.fileSearchStores.create({ config: { displayName } });
        return ragStore.name || "";
    } catch (err: any) {
        throw handleApiError(err, "createRagStore");
    }
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = getAI() as any;
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
    const maxRetries = 240; // Increased to 20 minutes (240 * 5s)
    
    while (retries < maxRetries) {
        await delay(5000); 
        try {
            const currentOp = await ai.operations.get({ name: op.name });
            if (currentOp) {
                op = currentOp;
                if (op.done) break;
            }
            retries++;
        } catch (pollErr: any) {
            console.warn("Polling operation status failed, retrying...", pollErr);
            retries++;
        }
    }
    
    if (retries >= maxRetries && !op.done) {
        throw new Error("INDEXING_TIMEOUT: Indexing is taking longer than expected. The file is uploaded and will appear in your library shortly.");
    }
    
    if (op.error) {
        throw new Error(`Cloud Error during indexing: ${op.error.message}`);
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
    // Use gemini-3-flash-preview for high-speed retrieval tasks.
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

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    try {
        const ai = getAI();
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
