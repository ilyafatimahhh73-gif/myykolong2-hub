// Firebase Configuration for MyKolong2 Hub
// Shared initialization file — imported by all pages

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export const firebaseConfig = {
    apiKey: "AIzaSyD9-IaN7UXw0fITEy9LlkY1J16rilsebfE",
    authDomain: "mykolong2-hub.firebaseapp.com",
    projectId: "mykolong2-hub",
    storageBucket: "mykolong2-hub.firebasestorage.app",
    messagingSenderId: "126066457091",
    appId: "1:126066457091:web:6001657a23358cd1432c36",
    measurementId: "G-TF5F9JEMCY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export auth and firestore instances for use across all pages
export const auth = getAuth(app);
export const db = getFirestore(app);
