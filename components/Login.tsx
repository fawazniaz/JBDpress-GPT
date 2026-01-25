
import React, { useState } from 'react';
import { User } from '../types';

interface LoginProps {
    onLogin: (user: User) => void;
}

const PAKISTAN_PROVINCES = ["Punjab", "Sindh", "KPK", "Balochistan", "Gilgit-Baltistan", "Azad Kashmir"];
const ADMIN_EMAIL = "fawazniaz@gmail.com";

const Login: React.FC<LoginProps> = ({ onLogin }) => {
    const [step, setStep] = useState<'email' | 'otp' | 'register'>('email');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [location, setLocation] = useState(PAKISTAN_PROVINCES[0]);
    const [city, setCity] = useState('');
    const [schoolName, setSchoolName] = useState('');

    const handleSendOtp = (e: React.FormEvent) => {
        e.preventDefault();
        // Mandatory OTP flow for everyone
        console.log(`Sending mock OTP to ${email}`);
        setStep('otp');
    };

    const handleVerifyOtp = (e: React.FormEvent) => {
        e.preventDefault();
        // Mock OTP check: 1234 or empty for dev convenience
        if (otp === '1234' || otp === '') {
             setStep('register');
        } else {
            alert("Invalid OTP (Hint: try 1234 or leave blank)");
        }
    };

    const handleRegister = (e: React.FormEvent) => {
        e.preventDefault();
        // Admin role is strictly restricted to the specific email address
        const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user';
        
        onLogin({
            email,
            role,
            location,
            city,
            schoolName,
            registeredAt: Date.now()
        });
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gem-onyx-light dark:bg-gem-onyx-dark">
            <div className="w-full max-w-md bg-white dark:bg-gem-slate-dark p-8 rounded-3xl shadow-xl border border-gem-mist-light dark:border-gem-mist-dark">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-black text-gem-blue mb-1">JBDPRESS_GPT</h1>
                    <p className="text-[14px] font-bold text-gem-blue mb-2 uppercase tracking-wide">
                        Your Learning Partner! — Empowering Digital Education.
                    </p>
                    <p className="text-gem-offwhite-light/60 dark:text-gem-offwhite-dark/60 text-xs">Digital Textbook Repository</p>
                    {email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && step !== 'email' && (
                        <div className="mt-4 inline-block px-3 py-1 bg-amber-500/10 text-amber-600 text-[10px] font-bold rounded-full border border-amber-500/20">
                            ADMIN ACCOUNT DETECTED
                        </div>
                    )}
                </div>

                {step === 'email' && (
                    <form onSubmit={handleSendOtp} className="space-y-6">
                        <div>
                            <label className="block text-sm font-bold mb-2">Email Address</label>
                            <input 
                                type="email" required 
                                value={email} onChange={e => setEmail(e.target.value)}
                                className="w-full p-4 rounded-xl bg-gem-onyx-light dark:bg-gem-onyx-dark border border-gem-mist-light dark:border-gem-mist-dark focus:ring-2 focus:ring-gem-blue outline-none transition-all"
                                placeholder="name@example.com"
                            />
                        </div>
                        <button type="submit" className="w-full py-4 bg-gem-blue text-white font-bold rounded-xl shadow-lg hover:brightness-110 transition-all">
                            Verify Email & Send OTP
                        </button>
                    </form>
                )}

                {step === 'otp' && (
                    <form onSubmit={handleVerifyOtp} className="space-y-6">
                        <div className="text-center space-y-2">
                            <p className="text-sm">We've sent a verification code to</p>
                            <p className="font-bold text-gem-blue">{email}</p>
                        </div>
                        <input 
                            type="text" required maxLength={4}
                            value={otp} onChange={e => setOtp(e.target.value)}
                            className="w-full p-4 text-center text-2xl tracking-[1em] font-black rounded-xl bg-gem-onyx-light dark:bg-gem-onyx-dark border border-gem-mist-light dark:border-gem-mist-dark"
                            placeholder="0000"
                        />
                        <button type="submit" className="w-full py-4 bg-gem-blue text-white font-bold rounded-xl shadow-lg">
                            Verify OTP
                        </button>
                        <button onClick={() => setStep('email')} className="w-full text-sm text-gem-blue hover:underline">Change Email</button>
                    </form>
                )}

                {step === 'register' && (
                    <form onSubmit={handleRegister} className="space-y-6">
                        <h2 className="text-xl font-bold">Account Profile</h2>
                        <div>
                            <label className="block text-sm font-bold mb-2">School Name</label>
                            <input 
                                type="text" required 
                                value={schoolName} onChange={e => setSchoolName(e.target.value)}
                                className="w-full p-4 rounded-xl bg-gem-onyx-light dark:bg-gem-onyx-dark border border-gem-mist-light dark:border-gem-mist-dark"
                                placeholder="e.g. Beaconhouse, City School"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold mb-2">Province (Pakistan)</label>
                            <select 
                                value={location} onChange={e => setLocation(e.target.value)}
                                className="w-full p-4 rounded-xl bg-gem-onyx-light dark:bg-gem-onyx-dark border border-gem-mist-light dark:border-gem-mist-dark"
                            >
                                {PAKISTAN_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold mb-2">City</label>
                            <input 
                                type="text" required 
                                value={city} onChange={e => setCity(e.target.value)}
                                className="w-full p-4 rounded-xl bg-gem-onyx-light dark:bg-gem-onyx-dark border border-gem-mist-light dark:border-gem-mist-dark"
                                placeholder="e.g. Lahore, Karachi"
                            />
                        </div>
                        <button type="submit" className="w-full py-4 bg-gem-blue text-white font-bold rounded-xl shadow-lg">
                            Launch JBDPRESS_GPT
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default Login;
