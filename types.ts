
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

export interface CloudFile {
    name: string;
    displayName: string;
    sizeBytes: string;
    createTime: string;
}

export interface TextbookModule {
    name: string;
    storeName: string;
    books: string[];
}

export enum AppStatus {
    Initializing,
    Login,
    Registering,
    Welcome,
    Uploading,
    Chatting,
    AdminDashboard,
    Error,
}

export interface ChatMessage {
    role: 'user' | 'model';
    parts: { text: string }[];
}

export type PedagogicalMethod = 'standard' | 'blooms' | 'montessori' | 'pomodoro' | 'kindergarten' | 'lesson-plan';

export interface QueryResult {
    text: string;
    groundingChunks: any[];
}
