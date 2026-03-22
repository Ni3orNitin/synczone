// ─────────────────────────────────────────────────────────
//  STEP 1 → Go to https://console.firebase.google.com
//  STEP 2 → Create a project → Add web app → Copy config here
//  STEP 3 → Go to Realtime Database → Create database → Start in TEST MODE
//  STEP 4 → Deploy to Vercel (or run locally with Live Server)
// ─────────────────────────────────────────────────────────
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBrd9cydFHNeJdZNsKU6cYbpPUMukuzncE",
  authDomain: "synczone-f503a.firebaseapp.com",
  projectId: "synczone-f503a",
  storageBucket: "synczone-f503a.firebasestorage.app",
  messagingSenderId: "509144779369",
  appId: "1:509144779369:web:f0e68995dc0a2b120b30f8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);