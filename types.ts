
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export interface RagStore {
    name: string;
    displayName: string;
}

export interface User {
    email: string;
    role: 'admin' | 'user';
    location: string;
    city: string;
    schoolName: string;
    registeredAt: number;
}

export interface CustomMetadata {
  key?: string;
  stringValue?: string;
  stringListValue?: string[];
  numericValue?: number;
}

export interface Document {
    name: string;
    displayName: string;
    customMetadata?: CustomMetadata[];
}

export interface GroundingChunk {
    retrievedContext?: {
        text?: string;
    };
}

export interface QueryResult {
    text: string;
    groundingChunks: GroundingChunk[];
}

export enum AppStatus {
    Initializing,
    Login,
    Registering,
    Welcome, // Admin Management or User Home
    Uploading,
    Chatting,
    AdminDashboard,
    Error,
}

export interface ChatMessage {
    role: 'user' | 'model';
    parts: { text: string }[];
    groundingChunks?: GroundingChunk[];
}

export type PedagogicalMethod = 'standard' | 'blooms' | 'montessori' | 'pomodoro' | 'kindergarten' | 'lesson-plan';

export interface TextbookModule {
    name: string;
    storeName: string;
    books: string[];
}
