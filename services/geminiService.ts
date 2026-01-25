
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
    // Directly use process.env.API_KEY as per guidelines.
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

    // If the request fails with this message, reset key selection state as per guidelines.
    if (message.includes("Requested entity was not found.")) {
        if (typeof window !== 'undefined' && window.aistudio?.openSelectKey) {
            window.aistudio.openSelectKey();
        }
        return new Error("RESELECTION_REQUIRED: The selected API key was not found or is invalid. Please select a valid paid key.");
    }

    if (err.status === 403 || message.includes("API key not valid")) {
        return new Error("INVALID_KEY: Your API key was rejected. Double-check your Vercel settings.");
    }

    if (err instanceof TypeError && (message.includes("fetch") || message.includes("NetworkError"))) {
        return new Error("NETWORK_ERROR: The connection was interrupted. Large books are sensitive to Wi-Fi quality.");
    }

    if (message.includes("undefined") && context.includes("fileSearchStores")) {
        return new Error("SDK_INCOMPATIBILITY: The current version of the Gemini SDK does not support RAG stores in this environment.");
    }
    
    return new Error(`${context} failed: ${message}`);
}

/**
 * Fetches all existing RAG stores from the cloud.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    try {
        // Cast ai to any to access fileSearchStores which might not be in the base SDK types.
        const ai = getAI() as any;
        if (!ai.fileSearchStores) throw new Error("RAG_NOT_SUPPORTED");

        // Fixed: Cast storesResponse to any to resolve 'unknown' property access errors.
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
        // Cast ai to any to access non-standard properties.
        const ai = getAI() as any;
        if (!ai.fileSearchStores) throw new Error("RAG stores are not supported by this API key or SDK version.");
        const ragStore = await ai.fileSearchStores.create({ config: { displayName } });
        return ragStore.name || "";
    } catch (err: any) {
        throw handleApiError(err, "createRagStore");
    }
}

export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    // Cast ai to any to access non-standard properties.
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
    const maxRetries = 120; // 10 minutes
    
    while (!op.done && retries < maxRetries) {
        await delay(5000); 
        try {
            // Poll using the operation name, casting ai to any to access operations.
            op = await (ai as any).operations.get({ name: op.name });
            retries++;
        } catch (pollErr: any) {
            console.warn("Poll failed, retrying...", pollErr);
            retries++;
            continue;
        }
    }
    
    if (retries >= maxRetries && !op.done) {
        throw new Error("INDEXING_TIMEOUT: The cloud is still processing your book. It will appear in your library automatically in a few minutes.");
    }
    
    if (op.error) {
        throw new Error(`Cloud Error: ${op.error.message}`);
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
    // Selected gemini-3-pro-preview for complex reasoning/tutor tasks.
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
        const ai = getAI();
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: model,
            contents: query,
            config: {
                systemInstruction: instruction,
                // Cast tools to any as fileSearch is a non-standard tool in this SDK version.
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
            }
        });

        // Correctly accessing .text property as per guidelines.
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
        // Accessing .text property directly.
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
