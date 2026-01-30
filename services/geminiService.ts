
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality } from "@google/genai";
import { QueryResult, TextbookModule, CloudFile } from '../types';

const STABLE_REGISTRY_KEY = 'JBDPRESS_STABLE_REGISTRY_FINAL';

/**
 * Encodes a Uint8Array to a Base64 string manually to avoid dependencies.
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
 * Decodes a Base64 string to a Uint8Array manually.
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

/**
 * Creates a fresh AI instance with the current API Key.
 */
function getAIClient() {
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === '') {
        throw new Error("API Key is missing. Please authorize access.");
    }
    return new GoogleGenAI({ apiKey }) as any;
}

/**
 * Fetches all modules and their file lists.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    const ai = getAIClient();
    
    // Check if the experimental File Search feature is available in this SDK context
    if (!ai.fileSearchStores) {
        console.warn("fileSearchStores API not found in SDK instance.");
        return getLocalRepository();
    }

    try {
        let allStores: any[] = [];
        let pageToken: string | undefined = undefined;

        // 1. List all stores
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

        // 2. Fetch files for each store
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
            await delay(200);
        }

        localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(results));
        return results;
    } catch (err: any) {
        console.error("Module sync failed:", err);
        const msg = (err.message || "").toLowerCase();
        if (msg.includes("403") || msg.includes("permission_denied")) {
            throw new Error("Billing/Permission Error: RAG features require a paid Gemini API key.");
        }
        throw err;
    }
}

/**
 * Creates a new Rag Store (Textbook Module).
 */
export async function createRagStore(displayName: string): Promise<string> {
    const ai = getAIClient();
    if (!ai.fileSearchStores) throw new Error("File Search API is not supported by this key/SDK.");
    
    try {
        const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
        if (!ragStore || !ragStore.name) throw new Error("Failed to create store: No ID returned.");
        return ragStore.name;
    } catch (err: any) {
        console.error("Store creation error:", err);
        throw new Error(`Cloud Handshake Failed: ${err.message || 'Unknown API Error'}`);
    }
}

/**
 * Uploads a file to a specific module.
 */
export async function uploadToRagStore(ragStoreName: string, file: File, onProgress?: (msg: string) => void): Promise<void> {
    const ai = getAIClient();
    
    try {
        if (onProgress) onProgress(`Reading ${file.name}...`);
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const base64Data = encodeBase64(bytes);
        
        if (onProgress) onProgress(`Transferring to cloud...`);

        const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: {
                data: base64Data,
                mimeType: file.type || 'application/pdf',
                displayName: file.name
            }
        });
        
        if (!op || !op.name) throw new Error("Upload initiation failed: No operation returned.");

        let attempts = 0;
        const maxAttempts = 60;
        while (attempts < maxAttempts) {
            if (onProgress) onProgress(`Cloud indexing (${attempts + 1}/${maxAttempts})...`);
            await delay(4000);
            
            const currentOp: any = await ai.operations.get({ name: op.name });
            if (currentOp?.done) {
                if (currentOp.error) {
                    throw new Error(currentOp.error.message || "Cloud processing error.");
                }
                return;
            }
            attempts++;
        }
        throw new Error("Indexing timed out. The file might still appear shortly.");
    } catch (err: any) {
        console.error("Upload Error:", err);
        throw err;
    }
}

/**
 * Fetches all raw files for the dashboard.
 */
export async function listAllCloudFiles(): Promise<CloudFile[]> {
    const ai = getAIClient();
    if (!ai.files) return [];
    
    let allFiles: CloudFile[] = [];
    let pageToken: string | undefined = undefined;
    
    try {
        do {
            const res: any = await ai.files.list({ pageToken, pageSize: 50 });
            if (res.files) {
                allFiles = [...allFiles, ...res.files];
            }
            pageToken = res.nextPageToken;
            if (pageToken) await delay(300);
        } while (pageToken);
        return allFiles;
    } catch (e) {
        return [];
    }
}

export async function deleteRagStore(storeName: string): Promise<void> {
    const ai = getAIClient();
    try {
        await ai.fileSearchStores.delete({ fileSearchStoreName: storeName });
    } catch (e) {
        console.warn("Delete store failure:", e);
    }
    const local = getLocalRepository().filter(m => m.storeName !== storeName);
    localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(local));
}

export async function deleteRawFile(fileName: string): Promise<void> {
    const ai = getAIClient();
    if (!ai.files) return;
    await ai.files.delete({ name: fileName });
}

export async function fileSearch(ragStoreName: string, query: string, method: string = 'standard', useFastMode: boolean = false, bookFocus?: string): Promise<QueryResult> {
    const ai = getAIClient();
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
            systemInstruction: `You are a specialized textbook tutor for JBD Press. Use ONLY the provided textbook context to answer. Method: ${method}. Focus: ${bookFocus || 'Comprehensive'}`,
            tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
        }
    });
    return {
        text: response.text || "No information found in the textbooks.",
        groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
    };
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    const ai = getAIClient();
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: 'Suggest 3 high-quality study questions based on these materials.',
            config: {
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any],
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch (e) { 
        return ["What are the core concepts?", "Summarize the key findings.", "Explain the main terminology."]; 
    }
}

export async function connectLive(callbacks: any, method: string = 'standard'): Promise<any> {
    const ai = getAIClient();
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            systemInstruction: `You are an interactive tutor (Method: ${method}).`,
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
