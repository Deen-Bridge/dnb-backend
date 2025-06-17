// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC8LlmtlWXvbcbyVbdyv4r-tDsGhhukdag",
  authDomain: "deen-bridge-22195.firebaseapp.com",
  projectId: "deen-bridge-22195",
  storageBucket: "deen-bridge-22195.firebasestorage.app",
  messagingSenderId: "368531944242",
  appId: "1:368531944242:web:74b4dac299dfb691d35d2b",
  measurementId: "G-KBFHS58RN0",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
