// app.js (module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.24.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, setDoc,
  serverTimestamp, query, where, getDocs,
  onSnapshot, orderBy, limit, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js";

/*
  === SETUP REQUIRED ===
  1) Create a free Firebase project at https://console.firebase.google.com/
  2) Add a Web App and copy the firebaseConfig object
  3) Enable Firestore Database (in test mode for easy dev) in your project
  4) Paste your firebaseConfig below (replace the placeholders)
*/

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  console.warn("Firebase config not set — chat will not connect until you add it.");
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- Utility ----------
function uid(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

// ---------- DOM ----------
const startChatBtn = document.getElementById("startChatBtn");
const enterBtn = document.getElementById("enterBtn");
const statusEl = document.getElementById("status");
const lobby = document.getElementById("lobby");
const chatArea = document.getElementById("chatArea");
const messagesEl = document.getElementById("messages");
const msgForm = document.getElementById("msgForm");
const msgInput = document.getElementById("msgInput");
const leaveBtn = document.getElementById("leaveBtn");
const waitingBox = document.getElementById("waitingBox");
const partnerState = document.getElementById("partnerState");
const reportBtn = document.getElementById("reportBtn");
const endBtn = document.getElementById("endBtn");
const contactForm = document.getElementById("contactForm");
const contactStatus = document.getElementById("contactStatus");
document.getElementById("year").textContent = new Date().getFullYear();

// Quick nav link for start
startChatBtn && startChatBtn.addEventListener("click", ()=> document.querySelector("#chat").scrollIntoView({behavior:"smooth"}));

// State
let myId = "u_" + uid(8);
let currentRoomId = null;
let unsubscribeMessages = null;
let unsubscribeRoom = null;
let partnerId = null;

// COLLECTIONS
const roomsCol = collection(db, "rooms");
const msgsCol = collection(db, "messages");
const reportsCol = collection(db, "reports");
const contactsCol = collection(db, "contacts");

// ---------- Chat Pairing Logic ----------
async function enterChat() {
  statusEl.textContent = "Finding a partner...";
  // 1) Try to find a waiting room
  const q = query(roomsCol, where("status", "==", "waiting"));
  const snap = await getDocs(q);

  if (!snap.empty) {
    // join the first waiting room
    const roomDoc = snap.docs[0];
    const roomRef = doc(db, "rooms", roomDoc.id);

    await updateDoc(roomRef, {
      status: "active",
      participant2: myId,
      updatedAt: serverTimestamp()
    });

    currentRoomId = roomDoc.id;
    partnerId = roomDoc.data().participant1;
    statusEl.textContent = "Connected";
    openChat(currentRoomId, false);
  } else {
    // create a waiting room
    const r = await addDoc(roomsCol, {
      participant1: myId,
      participant2: null,
      status: "waiting",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    currentRoomId = r.id;
    partnerId = null;
    statusEl.textContent = "Waiting for another person to join...";
    waitingBox.classList.remove("hidden");
    // listen for room updates (someone joins)
    const roomRef = doc(db, "rooms", currentRoomId);
    unsubscribeRoom = onSnapshot(roomRef, (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.status === "active" && data.participant2 && !partnerId) {
        partnerId = data.participant2;
        statusEl.textContent = "Connected";
        waitingBox.classList.add("hidden");
        openChat(currentRoomId, true);
      }
    });
  }

  // UI toggles
  enterBtn.classList.add("hidden");
  leaveBtn.classList.remove("hidden");
}

function openChat(roomId, amSecond) {
  // show chat area, register message listener
  chatArea.classList.remove("hidden");
  lobby.classList.add("hidden");
  partnerState.textContent = "Connected";

  const q = query(msgsCol, where("roomId", "==", roomId), orderBy("sentAt", "asc"));
  unsubscribeMessages = onSnapshot(q, (snap) => {
    messagesEl.innerHTML = "";
    snap.forEach(docSnap => {
      const m = docSnap.data();
      const el = document.createElement("div");
      el.className = "msg-bubble " + (m.sender === myId ? "me" : "other");
      el.textContent = m.text;
      messagesEl.appendChild(el);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// send a message to the room
async function sendMessage(text) {
  if (!currentRoomId) return;
  await addDoc(msgsCol, {
    roomId: currentRoomId,
    sender: myId,
    text: text,
    sentAt: serverTimestamp()
  });
}

async function leaveChat(cleanupOnly = false) {
  // mark room as closed if both participants are set or if this was the only one
  if (currentRoomId) {
    const rRef = doc(db, "rooms", currentRoomId);
    try {
      await updateDoc(rRef, { status: "closed", updatedAt: serverTimestamp() });
    } catch (e) {
      // ignore
    }
  }
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeMessages = null;
  unsubscribeRoom = null;
  currentRoomId = null;
  partnerId = null;
  chatArea.classList.add("hidden");
  lobby.classList.remove("hidden");
  enterBtn.classList.remove("hidden");
  leaveBtn.classList.add("hidden");
  waitingBox.classList.add("hidden");
  statusEl.textContent = "Not connected";
  partnerState.textContent = "—";
}

// Report: write a report doc with roomId and reason
async function sendReport(reason) {
  await addDoc(reportsCol, {
    roomId: currentRoomId || null,
    reporter: myId,
    reason,
    createdAt: serverTimestamp()
  });
  alert("Report sent. Thank you — we will review it.");
}

// contact form sends a doc to contacts collection
contactForm && contactForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("contactMsg").value.trim();
  if (!msg) {
    contactStatus.textContent = "Please enter a message.";
    return;
  }
  try {
    await addDoc(contactsCol, {
      message: msg,
      createdAt: serverTimestamp()
    });
    contactStatus.textContent = "Thanks — message sent.";
    contactForm.reset();
  } catch (err) {
    contactStatus.textContent = "Error sending message.";
  }
});

// ---------- UI events ----------
enterBtn && enterBtn.addEventListener("click", enterChat);
leaveBtn && leaveBtn.addEventListener("click", () => leaveChat());
endBtn && endBtn.addEventListener("click", () => leaveChat());
reportBtn && reportBtn.addEventListener("click", async () => {
  const reason = prompt("Why are you reporting this chat? (abuse, sexual content, spam, other)");
  if (reason) {
    await sendReport(reason);
    leaveChat();
  }
});

if (msgForm) {
  msgForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    await sendMessage(text);
    msgInput.value = "";
  });
}

// leave chat on page unload for cleanup
window.addEventListener("beforeunload", () => {
  if (currentRoomId) {
    // best-effort: close the room
    // (async not guaranteed on unload)
  }
});
