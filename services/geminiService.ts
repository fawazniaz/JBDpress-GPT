
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
    if (file.type && file.type.trim() !== '' && file.type !== 'application/octet-stream') {
        return file.type;
    }
    const name = file.name || "";
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'pdf': return 'application/pdf';
        case 'txt': return 'text/plain';
        case 'md': return 'text/markdown';
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        default: return 'application/pdf'; // Aggressive default for textbooks
    }
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
                    name: s.displayName || s.name.split('/').pop(),
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
 * Uploads a file using the most direct SDK-supported method.
 */
export async function uploadToRagStore(ragStoreName: string, file: File, onProgress?: (msg: string) => void): Promise<void> {
    const ai = getAIClient();
    const mimeType = getMimeType(file);
    
    try {
        if (onProgress) onProgress(`Uploading ${file.name}...`);

        /**
         * The most stable way to upload in recent SDK versions is passing the File (Blob)
         * directly or a BufferSource. We use ArrayBuffer to ensure binary parity.
         */
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);

        const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: {
                data: data,
                mimeType: mimeType,
                displayName: file.name
            }
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
        // Show the actual error message from the Google API
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
        for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
    return buffer;
}
