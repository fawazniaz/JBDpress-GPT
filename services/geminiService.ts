
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality } from "@google/genai";
import { QueryResult, TextbookModule, CloudFile } from '../types';

const STABLE_REGISTRY_KEY = 'JBDPRESS_STABLE_REGISTRY_FINAL';

/**
 * Standardizes the MIME type for RAG compatibility.
 */
function getMimeType(file: File): string {
    const name = file.name || "";
    const ext = name.split('.').pop()?.toLowerCase();
    
    // Hard-coded mapping to ensure we don't send 'application/octet-stream'
    const mimeMap: Record<string, string> = {
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };

    if (ext && mimeMap[ext]) return mimeMap[ext];

    if (file.type && file.type.trim() !== '' && file.type !== 'application/octet-stream') {
        return file.type;
    }
    
    return 'application/pdf'; 
}

/**
 * Manual Base64 encoding.
 */
export const encodeBase64 = (b: Uint8Array): string => {
    let binary = '';
    const len = b.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(b[i]);
    }
    return btoa(binary);
};

/**
 * Manual Base64 decoding.
 */
export const decodeBase64 = (s: string): Uint8Array => {
    const binaryString = atob(s);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLocalRepository(): TextbookModule[] {
    try {
        const data = JSON.parse(localStorage.getItem(STABLE_REGISTRY_KEY) || '[]');
        return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
}

function getAIClient() {
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey.trim() === '') {
        throw new Error("API Key is missing. Please authorize Gemini access.");
    }
    return new GoogleGenAI({ apiKey }) as any;
}

/**
 * Syncs the modules list with the cloud.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    const ai = getAIClient();
    if (!ai.fileSearchStores) return getLocalRepository();

    try {
        let allStores: any[] = [];
        let pageToken: string | undefined = undefined;
        do {
            const cloudResponse: any = await ai.fileSearchStores.list({ pageToken, pageSize: 20 });
            const stores = cloudResponse.fileSearchStores || cloudResponse.stores || [];
            allStores = [...allStores, ...stores];
            pageToken = cloudResponse.nextPageToken;
            if (pageToken) await delay(400);
        } while (pageToken);

        if (allStores.length === 0) {
            localStorage.setItem(STABLE_REGISTRY_KEY, '[]');
            return [];
        }

        const results: TextbookModule[] = [];
        for (const s of allStores) {
            try {
                const filesRes: any = await ai.fileSearchStores.listFilesSearchStoreFiles({ 
                    fileSearchStoreName: s.name 
                });
                const files = filesRes.fileSearchStoreFiles || filesRes.files || [];
                results.push({
                    name: s.displayName || s.name.split('/').pop() || "Untitled Module",
                    storeName: s.name,
                    books: files.map((f: any) => f.displayName || f.name)
                });
            } catch (e) {
                results.push({ name: s.displayName || s.name, storeName: s.name, books: [] });
            }
        }
        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(results));
        return results;
    } catch (err: any) {
        console.error("Module list failed:", err);
        throw err;
    }
}

/**
 * Creates a module container.
 */
export async function createRagStore(displayName: string): Promise<string> {
    const ai = getAIClient();
    try {
        const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
        return ragStore.name;
    } catch (err: any) {
        throw new Error(`Cloud Error: ${err.message}`);
    }
}

/**
 * Uploads a file to a RAG store.
 * The SDK error "Please provide mimeType in the config" implies the mimeType must be
 * present inside a 'config' object passed to the upload method.
 */
export async function uploadToRagStore(ragStoreName: string, file: File, onProgress?: (msg: string) => void): Promise<void> {
    const ai = getAIClient();
    const mimeType = getMimeType(file);
    
    try {
        if (onProgress) onProgress(`Reading ${file.name}...`);
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);

        if (onProgress) onProgress(`Uploading ${file.name}...`);

        /**
         * To satisfy the "Please provide mimeType in the config" error:
         * We wrap the upload parameters such that mimeType is both in the file object
         * AND inside a top-level 'config' object.
         */
        const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: {
                data: data,
                mimeType: mimeType,
                displayName: file.name
            },
            config: {
                mimeType: mimeType
            },
            // Redundant top-level property just in case
            mimeType: mimeType 
        });
        
        if (!op || !op.name) throw new Error("Cloud rejected the upload request.");

        let attempts = 0;
        const maxAttempts = 150; 
        while (attempts < maxAttempts) {
            if (onProgress) onProgress(`Indexing ${file.name} (${attempts + 1})...`);
            await delay(4000);
            
            const currentOp: any = await ai.operations.get({ name: op.name });
            if (currentOp?.done) {
                if (currentOp.error) {
                    throw new Error(`Cloud Indexing Error: ${currentOp.error.message}`);
                }
                return;
            }
            attempts++;
        }
        throw new Error("Indexing timed out. The file might still appear later.");
    } catch (err: any) {
        console.error("Upload process failed:", err);
        // Throw the specific error message to help debug if it happens again
        throw new Error(err.message || "An unknown error occurred during cloud upload.");
    }
}

export async function listAllCloudFiles(): Promise<CloudFile[]> {
    const ai = getAIClient();
    if (!ai.files) return [];
    try {
        const res: any = await ai.files.list({ pageSize: 100 });
        return res.files || [];
    } catch (e) { return []; }
}

export async function deleteRagStore(storeName: string): Promise<void> {
    const ai = getAIClient();
    await ai.fileSearchStores.delete({ fileSearchStoreName: storeName });
}

export async function deleteRawFile(fileName: string): Promise<void> {
    const ai = getAIClient();
    if (ai.files) await ai.files.delete({ name: fileName });
}

export async function fileSearch(ragStoreName: string, query: string, method: string = 'standard', useFastMode: boolean = false, bookFocus?: string): Promise<QueryResult> {
    const ai = getAIClient();
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
            systemInstruction: `You are a specialized textbook tutor. Answer ONLY based on textbooks. Mode: ${method}.`,
            tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
        }
    });
    return {
        text: response.text || "No information found.",
        groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || []
    };
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    const ai = getAIClient();
    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: "List 3 short study questions for these books.",
            config: {
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any],
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch (e) { return ["Summary?", "Key themes?", "Definitions?"]; }
}

export function connectLive(callbacks: any, method: string = 'standard') {
    const ai = getAIClient();
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            systemInstruction: `Tutor (Mode: ${method}).`,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
        }
    });
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
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
