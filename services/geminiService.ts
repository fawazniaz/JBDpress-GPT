
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality, LiveServerMessage } from "@google/genai";
import { QueryResult } from '../types';

/**
 * Creates a new instance of the Google GenAI SDK.
 * Always creates a fresh instance to catch updated environment variables.
 */
function getAI() {
    const key = process.env.API_KEY;
    if (!key || key === 'undefined' || key === '') {
        throw new Error("Missing API Key. Please go to Vercel Settings -> Environment Variables and add 'API_KEY'.");
    }
    return new GoogleGenAI({ apiKey: key });
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createRagStore(displayName: string): Promise<string> {
    const ai = getAI();
    try {
        const ragStore = await ai.fileSearchStores.create({ config: { displayName } });
        return ragStore.name || "";
    } catch (err: any) {
        throw new Error(`Connection Error: ${err.message}. Please check your internet or API billing status.`);
    }
}

/**
 * Uploads a textbook file with a patient polling loop to handle server processing time.
 */
export async function uploadToRagStore(ragStoreName: string, file: File): Promise<void> {
    const ai = getAI();
    
    try {
        let op;
        const uploadFn = () => ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: file
        });

        try {
            op = await uploadFn();
        } catch (err: any) {
            // Retry once if the server is just momentarily busy
            if (err.message?.includes('Deadline') || err.status === 504 || err.status === 429) {
                await delay(4000);
                op = await uploadFn();
            } else {
                throw err;
            }
        }
        
        let retries = 0;
        const maxRetries = 150; // Wait up to 7.5 minutes
        
        while (!op.done && retries < maxRetries) {
            await delay(3000); 
            try {
                op = await ai.operations.get({ operation: op });
                retries++;
            } catch (pollErr: any) {
                // Ignore transient polling timeouts
                if (pollErr.message?.includes('Deadline') || pollErr.status === 504) {
                    retries++;
                    continue;
                }
                throw pollErr;
            }
        }
        
        if (retries >= maxRetries && !op.done) {
            throw new Error("Indexing is taking too long. Your file might be very large or the server is busy. Try refreshing.");
        }
        
        if (op.error) {
            throw new Error(`AI Reading Error: ${op.error.message}`);
        }
    } catch (err: any) {
        throw new Error(err.message || "Failed to upload textbook.");
    }
}

const BASE_GROUNDING_INSTRUCTION = `You are JBDPRESS_GPT, a strict RAG-based Textbook Tutor. 
CRITICAL RULE: Answer ONLY using the uploaded textbooks. Do not use outside knowledge.
If information is missing, say: "I apologize, but this is not in the textbooks."

USER DOWNLOADS & PDFS:
If a user asks for a download or a document: 
Do NOT say "I cannot." Instead, say: "I have prepared your document. Please use the Print (🖨️) button next to this message to save as PDF, or the Download (📥) button to save as a text file."`;

export async function fileSearch(
    ragStoreName: string, 
    query: string, 
    method: string = 'standard',
    useFastMode: boolean = false,
    bookFocus?: string
): Promise<QueryResult> {
    const ai = getAI();
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
        throw new Error(`AI Search Failed: ${err.message}`);
    }
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    const ai = getAI();
    try {
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
