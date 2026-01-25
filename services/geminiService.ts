/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult } from '../types';

/**
 * Creates a new instance of the Google GenAI SDK.
 * Note: process.env.API_KEY is injected at BUILD TIME by Vite.
 */
function getAI() {
    const key = process.env.API_KEY;
    
    // Explicit validation for injected environment variables
    if (!key || key === '' || key === 'undefined' || key.length < 5) {
        throw new Error("API_KEY_NOT_FOUND_IN_BUNDLE");
    }
    
    return new GoogleGenAI({ apiKey: key });
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Custom error handler to provide actionable instructions for the specific error encountered.
 */
function handleApiError(err: any, context: string): Error {
    console.error(`Gemini API Error [${context}]:`, err);
    
    let message = err.message || "Unknown API error";

    // Handle the specific "Failed to fetch" browser error
    if (err instanceof TypeError && (message.includes("fetch") || message.includes("NetworkError"))) {
        return new Error("NETWORK_CONNECTION_ERROR: The browser lost connection to Google during the upload. Please check your internet stability and try again.");
    }

    if (message === "API_KEY_NOT_FOUND_IN_BUNDLE") {
        return new Error("MISSING_KEY_ERROR: The API_KEY was not found in the application bundle. 1. Go to Vercel Settings -> Environment Variables. 2. Add 'API_KEY'. 3. IMPORTANT: You MUST Redeploy (Deployments -> Redeploy) for changes to take effect.");
    }
    
    // Check for specific rejection from Google servers
    if (message.includes("API key not valid") || message.includes("400")) {
        message = "INVALID_KEY: The API key was rejected by Google. Ensure the 'Generative Language API' is enabled in your Google Cloud Console and that the key is correct. If you just changed it, please trigger a REDEPLOY on Vercel.";
    } else if (message.includes("403") || message.includes("permission")) {
        message = "PERMISSION_DENIED: Your key is valid, but this feature (RAG/Indexing) requires a Paid Project. Ensure billing is enabled for your Google Cloud project.";
    } else if (message.includes("429") || message.includes("quota")) {
        message = "QUOTA_EXCEEDED: Rate limit reached. If this is a new project, ensure billing is active to increase limits.";
    }
    
    return new Error(message);
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

    const uploadFn = () => ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: ragStoreName,
        file: file
    });

    // Outer loop for the initial upload request (handling 'Failed to fetch')
    while (attempts < maxAttempts) {
        try {
            op = await uploadFn();
            break; // Success, break the retry loop
        } catch (err: any) {
            attempts++;
            const isNetworkError = err instanceof TypeError || err.message?.includes('fetch');
            const isRetryableStatus = err.status === 504 || err.status === 429 || err.status === 503;

            if ((isNetworkError || isRetryableStatus) && attempts < maxAttempts) {
                console.warn(`Upload attempt ${attempts} failed. Retrying in 5s...`, err);
                await delay(5000);
                continue;
            }
            throw handleApiError(err, "uploadToRagStore");
        }
    }

    if (!op) throw new Error("UPLOAD_FAILED: Could not initiate upload.");
    
    // Inner loop for polling the operation status
    let retries = 0;
    const maxRetries = 150; 
    
    while (!op.done && retries < maxRetries) {
        await delay(3000); 
        try {
            op = await ai.operations.get({ operation: op });
            retries++;
        } catch (pollErr: any) {
            // Be lenient with polling errors, they are often transient
            if (pollErr.message?.includes('Deadline') || pollErr.status === 504 || pollErr instanceof TypeError) {
                retries++;
                continue;
            }
            throw handleApiError(pollErr, "pollUploadStatus");
        }
    }
    
    if (retries >= maxRetries && !op.done) {
        throw new Error("INDEXING_TIMEOUT: File is taking too long to index. Large textbooks can sometimes take several minutes.");
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
    if (bookFocus) {
        instruction += `\n\nFOCUS: Only search in the book: "${bookFocus}".`;
    }
    
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
            text: response.text || "I found no relevant information in the library.",
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