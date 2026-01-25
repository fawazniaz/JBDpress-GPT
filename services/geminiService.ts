/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult } from '../types';

/**
 * Creates a new instance of the Google GenAI SDK.
 */
function getAI() {
    const key = process.env.API_KEY;
    
    // Validate that the key exists
    if (!key || key === '' || key === 'undefined') {
        throw new Error("API_KEY_MISSING");
    }
    
    return new GoogleGenAI({ apiKey: key });
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Custom error handler to extract meaningful messages from API responses
 */
function handleApiError(err: any, context: string): Error {
    console.error(`Gemini API Error [${context}]:`, err);
    
    if (err.message === "API_KEY_MISSING") {
        return new Error("MISSING_KEY: Please add 'API_KEY' to Vercel Environment Variables and REDEPLOY.");
    }

    let message = err.message || "Unknown API error";
    
    if (message.includes("403") || message.includes("permission")) {
        message = "PERMISSION_DENIED: 1. Enable 'Generative Language API' in Google Cloud. 2. Attach a Billing Method (RAG requires a paid project).";
    } else if (message.includes("404") || message.includes("not found")) {
        message = "NOT_FOUND: The requested feature (File Search) might not be available in your current API project region.";
    } else if (message.includes("429") || message.includes("quota")) {
        message = "QUOTA_EXCEEDED: Too many requests. Please wait a minute.";
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
    try {
        const ai = getAI();
        let op;
        const uploadFn = () => ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: file
        });

        try {
            op = await uploadFn();
        } catch (err: any) {
            if (err.message?.includes('Deadline') || err.status === 504 || err.status === 429) {
                await delay(5000);
                op = await uploadFn();
            } else {
                throw err;
            }
        }
        
        let retries = 0;
        const maxRetries = 150; 
        
        while (!op.done && retries < maxRetries) {
            await delay(3000); 
            try {
                op = await ai.operations.get({ operation: op });
                retries++;
            } catch (pollErr: any) {
                if (pollErr.message?.includes('Deadline') || pollErr.status === 504) {
                    retries++;
                    continue;
                }
                throw pollErr;
            }
        }
        
        if (retries >= maxRetries && !op.done) {
            throw new Error("INDEXING_TIMEOUT: The file processing is taking longer than expected. Large PDFs can take several minutes.");
        }
        
        if (op.error) {
            throw new Error(`AI_READ_ERROR: ${op.error.message}`);
        }
    } catch (err: any) {
        throw handleApiError(err, "uploadToRagStore");
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