import { generatePlan } from './src/lib/AIEngine.js';

const messages = [
  { role: 'assistant', content: "Hello! What's your occupation?" },
  { role: 'user', content: "I am a software engineer." },
  { role: 'assistant', content: "Weaving your perfect timeline..." }
];

const sysPrompt = {
  role: 'system',
  content: `Current time: 10:00 AM. Build a realistic schedule using these tasks: \n- Code reviews (ID: 1)`
};

async function test() {
  try {
    const result = await generatePlan([sysPrompt, ...messages], "User is a dev.");
    console.log("SUCCESS:", result);
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}

test();
