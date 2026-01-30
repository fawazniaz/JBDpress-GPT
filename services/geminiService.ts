
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, Modality } from "@google/genai";
import { QueryResult, TextbookModule, CloudFile } from '../types';

const STABLE_REGISTRY_KEY = 'JBDPRESS_STABLE_REGISTRY_FINAL';

function getLocalRepository(): TextbookModule[] {
    try {
        const data = JSON.parse(localStorage.getItem(STABLE_REGISTRY_KEY) || '[]');
        return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const encodeBase64 = (b: Uint8Array) => {
    let binary = '';
    const len = b.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(b[i]);
    }
    return btoa(binary);
};

export const decodeBase64 = (s: string) => {
    const binaryString = atob(s);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

/**
 * Fetches all raw files in the project.
 */
export async function listAllCloudFiles(): Promise<CloudFile[]> {
    const key = process.env.API_KEY;
    if (!key) return [];
    
    const ai = new GoogleGenAI({ apiKey: key }) as any;
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
            if (pageToken) await delay(500);
        } while (pageToken);
        
        return allFiles;
    } catch (e) {
        console.warn("Cloud files list failure:", e);
        return [];
    }
}

export async function deleteRawFile(fileName: string): Promise<void> {
    const key = process.env.API_KEY;
    if (!key) return;
    const ai = new GoogleGenAI({ apiKey: key }) as any;
    if (!ai.files) return;
    await ai.files.delete({ name: fileName });
}

/**
 * Fetches all modules and their file lists.
 */
export async function listAllModules(): Promise<TextbookModule[]> {
    const key = process.env.API_KEY;
    const localData = getLocalRepository();
    
    if (!key || key.trim() === '') {
        throw new Error("No API Key detected. Please use the 'Authorize' button.");
    }

    const ai = new GoogleGenAI({ apiKey: key }) as any;
    if (!ai.fileSearchStores) return localData;

    try {
        console.debug("Attempting to list File Search Stores...");
        let allStores: any[] = [];
        let pageToken: string | undefined = undefined;

        do {
            const cloudResponse: any = await ai.fileSearchStores.list({ pageToken, pageSize: 20 });
            const stores = cloudResponse.fileSearchStores || cloudResponse.stores || [];
            allStores = [...allStores, ...stores];
            pageToken = cloudResponse.nextPageToken;
            if (pageToken) await delay(500);
        } while (pageToken);

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

        if (results.length > 0) {
            localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(results));
            return results;
        }
        
        // If we reached here, the call succeeded but returned 0 stores.
        localStorage.setItem(STABLE_REGISTRY_KEY, '[]');
        return [];
    } catch (err: any) {
        console.error("Critical error listing modules:", err);
        const msg = (err.message || "").toLowerCase();
        if (msg.includes("403") || msg.includes("permission_denied")) {
            throw new Error("Permission Denied: Ensure your API Key is from a project with billing enabled for File Search (RAG).");
        }
        if (msg.includes("401") || msg.includes("unauthenticated")) {
            throw new Error("Invalid API Key: Please refresh your key and try again.");
        }
        // Fallback to local data if it's a transient network error
        return localData;
    }
}

export async function createRagStore(displayName: string): Promise<string> {
    const key = process.env.API_KEY;
    if (!key) throw new Error("API Key missing.");
    
    const ai = new GoogleGenAI({ apiKey: key }) as any;
    try {
        console.debug("Creating Rag Store:", displayName);
        const ragStore: any = await ai.fileSearchStores.create({ config: { displayName } });
        if (!ragStore || !ragStore.name) throw new Error("Handshake failed: No store name returned.");
        return ragStore.name;
    } catch (err: any) {
        console.error("Store creation error:", err);
        throw err;
    }
}

export async function uploadToRagStore(ragStoreName: string, file: File, onProgress?: (msg: string) => void): Promise<void> {
    const key = process.env.API_KEY;
    if (!key) throw new Error("API Key missing.");
    
    const ai = new GoogleGenAI({ apiKey: key }) as any;
    
    try {
        if (onProgress) onProgress(`Reading ${file.name} bytes...`);
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        
        if (onProgress) onProgress(`Transferring to cloud...`);

        // Use raw bytes (Uint8Array) for the data field
        const op: any = await ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: ragStoreName,
            file: {
                data: bytes,
                mimeType: file.type || 'application/pdf',
                displayName: file.name
            }
        });
        
        if (!op || !op.name) throw new Error("Cloud upload initiation failed.");

        let attempts = 0;
        while (attempts < 60) {
            if (onProgress) onProgress(`Cloud indexing (${attempts + 1}/60)...`);
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
        throw new Error("Cloud indexing timed out.");
    } catch (err: any) {
        console.error("RAG Upload Error:", err);
        throw err;
    }
}

export async function deleteRagStore(storeName: string): Promise<void> {
    const key = process.env.API_KEY;
    if (!key) return;
    const ai = new GoogleGenAI({ apiKey: key }) as any;
    try {
        await ai.fileSearchStores.delete({ fileSearchStoreName: storeName });
    } catch (e) {
        console.warn("Delete store failure:", e);
    }
    const local = getLocalRepository().filter(m => m.storeName !== storeName);
    localStorage.setItem(STABLE_REGISTRY_KEY, JSON.stringify(local));
}

export async function fileSearch(ragStoreName: string, query: string, method: string = 'standard', useFastMode: boolean = false, bookFocus?: string): Promise<QueryResult> {
    const key = process.env.API_KEY;
    if (!key) throw new Error("API Key missing.");
    const ai = new GoogleGenAI({ apiKey: key });
    
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: query,
        config: {
            systemInstruction: `You are a specialized textbook tutor for JBD Press. Use ONLY the provided textbook context to answer. If the information isn't in the textbook, state it clearly. Method: ${method}. Focus: ${bookFocus || 'Comprehensive'}`,
            tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any]
        }
    });
    return {
        text: response.text || "No relevant information found in the textbooks for this unit.",
        groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || [],
    };
}

export async function generateExampleQuestions(ragStoreName: string): Promise<string[]> {
    const key = process.env.API_KEY;
    if (!key) return [];
    
    try {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: 'Analyze these textbooks and suggest 3 high-quality study questions.',
            config: {
                tools: [{ fileSearch: { fileSearchStoreNames: [ragStoreName] } } as any],
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        const text = response.text || "[]";
        return JSON.parse(text);
    } catch (e) { 
        console.warn("Questions generation failure:", e);
        return ["What are the core concepts covered in this unit?", "Can you summarize the main findings?", "Explain the relationship between the key terms."]; 
    }
}

export async function connectLive(callbacks: any, method: string = 'standard'): Promise<any> {
    const key = process.env.API_KEY;
    if (!key) throw new Error("API Key missing.");
    const ai = new GoogleGenAI({ apiKey: key });
    
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            systemInstruction: `You are an interactive tutor (Method: ${method}). Listen and respond to textbook queries using natural, encouraging language.`,
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
