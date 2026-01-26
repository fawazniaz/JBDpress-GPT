/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessage, PedagogicalMethod, User } from '../types';
import Spinner from './Spinner';
import { SendIcon, DownloadIcon } from './Icons';
import * as geminiService from '../services/geminiService';

interface ChatInterfaceProps {
    user: User;
    documentName: string;
    booksInStore: string[];
    history: ChatMessage[];
    isQueryLoading: boolean;
    onSendMessage: (message: string, method?: PedagogicalMethod, fastMode?: boolean, bookFocus?: string) => void;
    addChatMessage: (role: 'user' | 'model', text: string) => void;
    onBack: () => void;
    exampleQuestions: string[];
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ user, documentName, booksInStore, history, isQueryLoading, onSendMessage, addChatMessage, onBack, exampleQuestions }) => {
    const [query, setQuery] = useState('');
    const [method, setMethod] = useState<PedagogicalMethod>('standard');
    const [selectedBook, setSelectedBook] = useState<string>('All Books');
    const [fastMode, setFastMode] = useState(false);
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [userTranscript, setUserTranscript] = useState('');
    const [aiTranscript, setAiTranscript] = useState('');
    const [isAiThinking, setIsAiThinking] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const sessionPromiseRef = useRef<any>(null);
    const isStoppingRef = useRef(false);
    const currentUserTranscriptRef = useRef('');
    const currentAiTranscriptRef = useRef('');

    const methods: { id: PedagogicalMethod, label: string, desc: string, icon: string }[] = [
        { id: 'standard', label: 'Standard', desc: 'Direct textbook answers', icon: '📖' },
        { id: 'blooms', label: "Bloom's", desc: "Cognitive analysis levels", icon: '🧠' },
        { id: 'montessori', label: 'Montessori', desc: 'Discovery-led learning', icon: '🌱' },
        { id: 'pomodoro', label: 'Pomodoro', desc: 'Focused study sprints', icon: '🍅' },
        { id: 'kindergarten', label: 'Early Years', desc: 'Simple analogies', icon: '🧸' },
        { id: 'lesson-plan', label: 'Lesson Plan', desc: 'Teacher resources', icon: '📋' },
    ];

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history, isQueryLoading, userTranscript, aiTranscript]);

    const stopVoice = useCallback(() => {
        if (isStoppingRef.current) return;
        isStoppingRef.current = true;
        commitVoiceHistory();
        setIsVoiceActive(false);
        setIsMuted(false);
        setIsAiThinking(false);
        sessionPromiseRef.current = null;
        sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
        sourcesRef.current.clear();
        const closeContext = async (ctxRef: React.MutableRefObject<AudioContext | null>) => {
            const ctx = ctxRef.current;
            if (ctx && ctx.state !== 'closed') {
                try { await ctx.close(); } catch (e) {}
            }
            ctxRef.current = null;
        };
        Promise.all([closeContext(audioContextRef), closeContext(outputAudioContextRef)]).finally(() => {
            isStoppingRef.current = false;
        });
    }, []);

    const commitVoiceHistory = () => {
        if (currentUserTranscriptRef.current.trim()) {
            addChatMessage('user', `(Voice): ${currentUserTranscriptRef.current.trim()}`);
            currentUserTranscriptRef.current = '';
        }
        if (currentAiTranscriptRef.current.trim()) {
            addChatMessage('model', currentAiTranscriptRef.current.trim());
            currentAiTranscriptRef.current = '';
        }
        setUserTranscript('');
        setAiTranscript('');
    };

    const startVoice = async () => {
        if (isVoiceActive || isStoppingRef.current) return;
        setIsVoiceActive(true);
        setIsMuted(false);
        setIsAiThinking(false);
        setUserTranscript('');
        setAiTranscript('');
        currentUserTranscriptRef.current = '';
        currentAiTranscriptRef.current = '';
        nextStartTimeRef.current = 0;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            audioContextRef.current = inCtx;
            outputAudioContextRef.current = outCtx;
            const sessionPromise = geminiService.connectLive({
                onopen: () => {
                    const source = inCtx.createMediaStreamSource(stream);
                    const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
                    scriptProcessor.onaudioprocess = (e) => {
                        if (audioContextRef.current && !isMuted && sessionPromiseRef.current) {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
                            const base64 = geminiService.encodeBase64(new Uint8Array(int16.buffer));
                            sessionPromiseRef.current?.then((session: any) => {
                                if (session && typeof session.sendRealtimeInput === 'function') {
                                    session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
                                }
                            });
                        }
                    };
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(inCtx.destination);
                },
                onmessage: async (message: any) => {
                    if (!outputAudioContextRef.current) return;
                    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (audioData && outputAudioContextRef.current) {
                        setIsAiThinking(false);
                        const outCtx = outputAudioContextRef.current;
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
                        const buffer = await geminiService.decodeAudioData(geminiService.decodeBase64(audioData), outCtx, 24000, 1);
                        const source = outCtx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(outCtx.destination);
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += buffer.duration;
                        sourcesRef.current.add(source);
                        source.onended = () => sourcesRef.current.delete(source);
                    }
                    if (message.serverContent?.inputTranscription) {
                        const txt = message.serverContent.inputTranscription.text;
                        setUserTranscript(prev => prev + txt);
                        currentUserTranscriptRef.current += txt;
                        setIsAiThinking(true);
                    }
                    if (message.serverContent?.outputTranscription) {
                        const txt = message.serverContent.outputTranscription.text;
                        setAiTranscript(prev => prev + txt);
                        currentAiTranscriptRef.current += txt;
                        setIsAiThinking(false);
                    }
                    if (message.serverContent?.turnComplete) {
                        commitVoiceHistory();
                        setIsAiThinking(false);
                    }
                    if (message.serverContent?.interrupted) {
                        sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
                        sourcesRef.current.clear();
                        nextStartTimeRef.current = 0;
                        setIsAiThinking(false);
                    }
                },
                onclose: () => stopVoice(),
                onerror: (e: any) => { console.error("Live API Error", e); stopVoice(); }
            }, method);
            sessionPromiseRef.current = sessionPromise;
        } catch (err) {
            console.error("Mic access denied or session failed", err);
            stopVoice();
        }
    };

    const handlePrint = (content: string) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        const html = `<html><head><title>Assessment - ${user.schoolName}</title><style>body { font-family: sans-serif; padding: 40px; }.header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; }.school-name { font-size: 24px; font-weight: bold; }.info { display: flex; justify-content: space-between; font-size: 14px; margin-top: 10px; }.content { line-height: 1.6; }</style></head><body><div class="header"><div class="school-name">${user.schoolName}</div><div>Digital Assessment System</div><div class="info"><span>Subject: _________</span><span>Date: ${new Date().toLocaleDateString()}</span><span>Student: _________</span></div></div><div class="content">${content.replace(/\n/g, '<br/>')}</div><script>window.onload = () => { window.print(); }</script></body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
    };

    const handleDownload = (content: string) => {
        const element = document.createElement("a");
        const file = new Blob([content], {type: 'text/plain'});
        element.href = URL.createObjectURL(file);
        element.download = `JBDPRESS_Assessment_${Date.now()}.txt`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            onSendMessage(query, method, fastMode, selectedBook === 'All Books' ? undefined : selectedBook);
            setQuery('');
        }
    };

    return (
        <div className="flex flex-col h-full bg-gem-onyx-light dark:bg-gem-onyx-dark transition-colors duration-300">
            <header className="p-4 border-b border-gem-mist-light dark:border-gem-mist-dark bg-white/80 dark:bg-gem-slate-dark/80 backdrop-blur-md z-10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center space-x-4 overflow-hidden w-full sm:w-auto">
                    <button onClick={onBack} className="p-2 hover:bg-gem-mist-light dark:hover:bg-gem-mist-dark rounded-full transition-colors">←</button>
                    <div className="truncate">
                        <h1 className="text-sm font-black truncate">{documentName}</h1>
                        <p className="text-[10px] opacity-40 uppercase tracking-tighter">{user.schoolName} • Textbook Grounding</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto">
                    <select 
                        value={selectedBook} 
                        onChange={(e) => setSelectedBook(e.target.value)}
                        className="bg-gem-onyx-light dark:bg-gem-onyx-dark border border-gem-mist-light dark:border-gem-mist-dark rounded-full px-3 py-1 text-[10px] font-bold"
                    >
                        <option value="All Books">All Books</option>
                        {booksInStore.map(book => <option key={book} value={book}>{book}</option>)}
                    </select>
                    <div className="flex space-x-1">
                        {methods.map(m => (
                            <button 
                                key={m.id}
                                onClick={() => setMethod(m.id)}
                                className={`px-3 py-1 text-[10px] font-bold rounded-full transition-all border whitespace-nowrap ${method === m.id ? 'bg-gem-blue text-white border-gem-blue' : 'bg-transparent border-gem-mist-light dark:border-gem-mist-dark opacity-60'}`}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>
            <div className="flex-grow overflow-y-auto p-4 lg:p-8">
                <div className="max-w-4xl mx-auto space-y-8">
                    {history.length === 0 && !userTranscript && (
                        <div className="text-center py-20 opacity-40">
                            <div className="text-6xl mb-6">📚</div>
                            <h2 className="text-2xl font-black">Ready to Study</h2>
                            <p className="text-xs italic">Only information from your textbooks will be used.</p>
                        </div>
                    )}
                    {history.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm text-sm relative group ${msg.role === 'user' ? 'bg-gem-blue text-white' : 'bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark'}`}>
                                <div dangerouslySetInnerHTML={{ __html: msg.parts[0].text.replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                                {msg.role === 'model' && (
                                    <div className="absolute -right-12 top-0 flex flex-col space-y-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handlePrint(msg.parts[0].text)} className="p-2 bg-gem-mist-light dark:bg-gem-mist-dark rounded-full">🖨️</button>
                                        <button onClick={() => handleDownload(msg.parts[0].text)} className="p-2 bg-gem-mist-light dark:bg-gem-mist-dark rounded-full"><DownloadIcon /></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isQueryLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark p-4 rounded-2xl flex items-center space-x-3">
                                <Spinner />
                                <span className="text-xs italic opacity-50">Reading textbook...</span>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>
            </div>
            <footer className="p-4 border-t border-gem-mist-light dark:border-gem-mist-dark bg-white/80 dark:bg-gem-slate-dark/80">
                <div className="max-w-4xl mx-auto flex items-center space-x-3 relative">
                    <button onClick={startVoice} className="p-4 bg-gem-teal text-white rounded-2xl shadow-lg">🎙️</button>
                    <div className="flex-grow relative">
                        <form onSubmit={handleSubmit}>
                            <input 
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Ask a question about the textbook..."
                                className="w-full py-4 pl-6 pr-14 bg-gem-onyx-light dark:bg-gem-onyx-dark rounded-2xl border border-gem-mist-light dark:border-gem-mist-dark focus:outline-none focus:ring-2 focus:ring-gem-blue"
                            />
                            <button type="submit" disabled={!query.trim() || isQueryLoading} className="absolute right-2 top-2 p-3 bg-gem-blue text-white rounded-xl disabled:opacity-30">
                                <SendIcon />
                            </button>
                        </form>
                    </div>
                </div>
            </footer>
        </div>
    );
};
export default ChatInterface;