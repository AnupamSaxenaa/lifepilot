import { AI_CONFIG } from '../config/env';

const asArray = (value, fallback) => {
  const list = Array.isArray(value) && value.length > 0
    ? value
    : (typeof value === 'string' && value.trim() ? [value.trim()] : fallback);
  return [...new Set(list.filter(Boolean))];
};

const GEMINI_MODELS = asArray(AI_CONFIG.GEMINI_MODELS, [
  AI_CONFIG.GEMINI_MODEL || 'gemini-2.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
]);

const GROQ_MODELS = asArray(AI_CONFIG.GROQ_MODELS, [
  AI_CONFIG.GROQ_MODEL || 'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
]);

const callAIProxy = async (mode, payload) => {
  if (!AI_CONFIG.AI_PROXY_URL) throw new Error('Missing AI proxy URL');

  const response = await fetch(AI_CONFIG.AI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, ...payload }),
  });

  if (!response.ok) throw new Error(`AI proxy error: ${response.status}`);
  return response.json();
};

const normalizeText = (value) => String(value || '').trim();

const stripJsonFences = (value) => normalizeText(value)
  .replace(/```json/gi, '')
  .replace(/```/g, '')
  .trim();

const sanitizeJsonText = (value) => stripJsonFences(value)
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/,\s*([}\]])/g, '$1');

const extractBalancedJson = (text, openChar, closeChar) => {
  const start = text.indexOf(openChar);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
};

const parseJsonFromText = (rawResponse) => {
  const cleaned = sanitizeJsonText(rawResponse);
  const candidates = [
    cleaned,
    extractBalancedJson(cleaned, '[', ']'),
    extractBalancedJson(cleaned, '{', '}'),
  ].filter(Boolean);

  let lastError;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No JSON found');
};

const normalizeTitleKey = (value) => normalizeText(value).toLowerCase().replace(/\s+/g, ' ');

const getTimeRange = (item) => {
  const direct = item.time || item.timeRange || item.time_range || item.slot;
  if (direct) return normalizeText(direct);

  const start = item.start || item.startTime || item.start_time;
  const end = item.end || item.endTime || item.end_time;
  if (start && end) return `${normalizeText(start)} - ${normalizeText(end)}`;
  return '';
};

const normalizePlan = (planItems, tasks = []) => {
  if (!Array.isArray(planItems)) throw new Error('Plan is not an array');

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const taskByTitle = new Map(
    safeTasks
      .filter(task => task?.title)
      .map(task => [normalizeTitleKey(task.title), task])
  );

  const normalized = planItems.map((item) => {
    if (!item || typeof item !== 'object') return null;

    const title = normalizeText(item.title || item.task || item.name);
    const time = getTimeRange(item);
    if (!title || !time) return null;

    const rawTaskId = item.taskId ?? item.task_id ?? item.id ?? null;
    const matchedTask = taskByTitle.get(normalizeTitleKey(title));
    const taskId = rawTaskId === null || rawTaskId === undefined || rawTaskId === 'null'
      ? (matchedTask?.id !== undefined ? String(matchedTask.id) : null)
      : String(rawTaskId);

    return {
      taskId,
      time,
      title,
      completed: Boolean(item.completed),
    };
  }).filter(Boolean);

  if (normalized.length === 0) throw new Error('Plan has no valid rows');
  return normalized;
};

const extractPlanItems = (parsed) => {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.schedule)) return parsed.schedule;
  if (Array.isArray(parsed?.plan)) return parsed.plan;
  if (Array.isArray(parsed?.tasks)) return parsed.tasks;
  throw new Error('No schedule array found');
};

const formatTime = (date) => {
  let h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
};

const roundToNextHalfHour = (date) => {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  rounded.setMinutes(minutes <= 30 ? 30 : 60);
  return rounded;
};

const buildFallbackSchedule = (tasks = []) => {
  const activeTasks = tasks.filter(task => task?.title && !task.is_completed).slice(0, 8);
  let cursor = roundToNextHalfHour(new Date());

  const fallback = activeTasks.length === 0 ? [{
      taskId: null,
      time: `${formatTime(cursor)} - ${formatTime(new Date(cursor.getTime() + 45 * 60000))}`,
      title: 'Plan and prioritize today',
      completed: false,
    }] : activeTasks.map((task) => {
    const start = new Date(cursor);
    const end = new Date(start.getTime() + 45 * 60000);
    cursor = new Date(end.getTime() + 15 * 60000);

    return {
      taskId: task.id !== undefined ? String(task.id) : null,
      time: `${formatTime(start)} - ${formatTime(end)}`,
      title: task.title,
      completed: Boolean(task.is_completed),
    };
  });
  
  fallback._isFallback = true;
  return fallback;
};

const callGemini = async (messages, options = {}) => {
  if (!AI_CONFIG.GEMINI_API_KEY || AI_CONFIG.GEMINI_API_KEY.includes('YOUR_')) {
    throw new Error('Gemini API key is missing or invalid');
  }
  
  // Convert standard roles to Gemini roles
  const safeMessages = Array.isArray(messages) ? messages : [];
  const prompt = safeMessages
    .filter(m => m && typeof m === 'object' && m.content)
    .map(m => {
      const role = m.role === 'user' ? 'User' : (m.role === 'system' ? 'System Instructions' : 'Assistant');
      return `${role}: ${m.content}`;
    })
    .join('\n\n');

  let lastError;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${AI_CONFIG.GEMINI_API_KEY}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: options.json ? 0.2 : 0.7,
            ...(options.json ? { responseMimeType: 'application/json' } : {}),
          },
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`Gemini ${model} Error ${response.status}: ${errorText}`);
        console.error('Gemini API Error:', errorText);
        continue;
      }

      const data = await response.json();
      if (!data.candidates || data.candidates.length === 0) {
        lastError = new Error(`Gemini ${model} returned empty response`);
        continue;
      }
      
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      lastError = error;
      console.error(`Gemini ${model} exception:`, error.message);
    }
  }

  throw lastError || new Error('All Gemini models failed');
};

const callGroq = async (messages, options = {}) => {
  if (!AI_CONFIG.GROQ_API_KEY || AI_CONFIG.GROQ_API_KEY.includes('YOUR_')) throw new Error('Missing Key');
  
  const safeMessages = Array.isArray(messages) ? messages.filter(m => m && typeof m === 'object') : [];
  
  let lastError;
  for (const model of GROQ_MODELS) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_CONFIG.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: safeMessages,
        temperature: options.json ? 0.2 : 0.7,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      })
    });
    
    if (!response.ok) {
      lastError = new Error(`Groq ${model} Error: ${response.status}`);
      continue;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw lastError || new Error('Groq failed');
};

const callMistral = async (messages, options = {}) => {
  if (!AI_CONFIG.MISTRAL_API_KEY || AI_CONFIG.MISTRAL_API_KEY.includes('YOUR_')) throw new Error('Missing Key');
  
  const safeMessages = Array.isArray(messages) ? messages.filter(m => m && typeof m === 'object') : [];
  
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AI_CONFIG.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: safeMessages,
      temperature: options.json ? 0.2 : 0.7,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    })
  });
  
  if (!response.ok) throw new Error(`Mistral Error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
};

const callCohere = async (messages) => {
  if (!AI_CONFIG.COHERE_API_KEY || AI_CONFIG.COHERE_API_KEY.includes('YOUR_')) throw new Error('Missing Key');
  
  const safeMessages = Array.isArray(messages) ? messages.filter(m => m && typeof m === 'object') : [];
  
  // Convert OpenAI format to Cohere chat history format
  const chatHistory = safeMessages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'user' ? 'USER' : 'CHATBOT',
    message: m.content || ''
  }));
  
  const lastMessageObj = chatHistory.pop();
  const lastMessage = lastMessageObj ? lastMessageObj.message : 'Plan my day';
  const systemPrompt = safeMessages.find(m => m.role === 'system')?.content || '';

  const response = await fetch('https://api.cohere.ai/v1/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AI_CONFIG.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      model: 'command-r',
      message: lastMessage,
      chat_history: chatHistory,
      preamble: systemPrompt
    })
  });
  
  if (!response.ok) throw new Error(`Cohere Error: ${response.status}`);
  const data = await response.json();
  return data.text;
};

/**
 * 4-Layer Fallback AI Engine (JSON Mode)
 * Attempts to hit all providers sequentially until one succeeds.
 * Expects the AI to return a JSON string.
 */
export const generatePlan = async (messages, currentMemory, tasks = []) => {
  if (AI_CONFIG.AI_PROXY_URL) {
    try {
      const proxyJson = await callAIProxy('generatePlan', { messages, currentMemory, tasks });
      return normalizePlan(extractPlanItems(proxyJson), tasks);
    } catch (error) {
      console.log('❌ AI proxy failed:', error.message);
    }
  }

  const safeMessages = Array.isArray(messages) ? messages : [];
  
  // Extract the system prompt passed from AIAuraOverlay (which is always messages[0])
  const callerSysPrompt = safeMessages.length > 0 && safeMessages[0].role === 'system' ? safeMessages[0].content : '';

  // Merge the instructions into a single System message to prevent Groq/Mistral 400 Errors
  const masterSystemInstruction = { 
    role: 'system', 
    content: `CRITICAL: You must respond ONLY with a raw, valid JSON object. Do not use markdown formatting like \`\`\`json.
Schema: { "schedule": [ { "taskId": "string_or_null", "time": "string (e.g. 9:00 AM - 10:00 AM)", "title": "string" } ] }

RULES:
1. If the user memory indicates they want a "Detailed Plan" or if it is implied, you MUST invent "Implicit Tasks" (e.g., waking up, breakfast, deep work blocks, gym, lunch) based on their occupation and habits.
2. For IMPLICIT TASKS (habits, meals, routines), you MUST set "taskId" to null.
3. For EXPLICIT TASKS provided in the prompt below, you MUST preserve their exact "taskId".
4. You MUST include any Calendar Events provided in the prompt in your schedule. Set their "taskId" to null, and use the exact title and time from the calendar. Do NOT overlap tasks with these calendar events.

USER'S PERSONAL MEMORY PROFILE:
${currentMemory || "No memory profile yet."}

${callerSysPrompt}` 
  };
  
  // Ignore chat history to prevent conversational distraction. Just demand the JSON.
  const finalMessages = [
    masterSystemInstruction,
    { role: 'user', content: 'Analyze the tasks and my memory profile above. Generate the final realistic schedule NOW. Output ONLY the raw JSON object.' }
  ];

  let rawResponse = '';
  try {
    console.log('🤖 Attempting Groq for generatePlan...');
    rawResponse = await callGroq(finalMessages, { json: true });
    console.log('✅ Groq succeeded. Response length:', rawResponse?.length);
  } catch (e1) {
    console.log('❌ Groq failed:', e1.message);
    try {
      console.log('🤖 Attempting Gemini for generatePlan...');
      rawResponse = await callGemini(finalMessages, { json: true });
      console.log('✅ Gemini succeeded. Response length:', rawResponse?.length);
    } catch (e2) {
      console.log('❌ Groq failed:', e2.message);
      try {
        console.log('🤖 Attempting Mistral for generatePlan...');
        rawResponse = await callMistral(finalMessages, { json: true });
        console.log('✅ Mistral succeeded. Response length:', rawResponse?.length);
      } catch (e3) {
        console.log('❌ Mistral failed:', e3.message);
        try {
          console.log('🤖 Attempting Cohere Command R for generatePlan...');
          rawResponse = await callCohere(finalMessages);
          console.log('✅ Cohere succeeded. Response length:', rawResponse?.length);
        } catch (e4) {
          console.log('❌ Cohere failed:', e4.message);
          console.log('⚠️ Using local fallback schedule because all AI services failed.');
          return buildFallbackSchedule(tasks);
        }
      }
    }
  }

// Parse the JSON
  try {
    console.log('🔍 Parsing AI response...');
    const parsed = parseJsonFromText(rawResponse);
    console.log('✅ JSON parsed successfully:', JSON.stringify(parsed).slice(0, 200));
    const normalized = normalizePlan(extractPlanItems(parsed), tasks);
    console.log('✅ Plan normalized. Items:', normalized.length);
    return normalized;
  } catch (parseError) {
    console.log('❌ AI Failed to return valid JSON array. Error:', parseError.message);
    console.log('Raw response:', rawResponse?.slice(0, 500));
    console.log('⚠️ Using local fallback schedule because AI returned invalid JSON.');
    return buildFallbackSchedule(tasks);
  }
};

/**
 * Chat Phase: The AI talks to the user and updates its persistent memory.
 * Expects the AI to return a JSON object with { reply, memory }
 */
export const chatWithAura = async (messages, currentMemory) => {
  if (AI_CONFIG.AI_PROXY_URL) {
    try {
      return await callAIProxy('chatWithAura', { messages, currentMemory });
    } catch (error) {
      console.log('❌ AI proxy chat failed:', error.message);
    }
  }

  const safeMessages = Array.isArray(messages) ? messages : [];
  const systemContext = safeMessages
    .filter(message => message && message.role === 'system')
    .map(message => message.content)
    .join('\n\n');
  const chatHistory = safeMessages.filter(message => message && message.role !== 'system');

  const jsonInstruction = { 
    role: 'system', 
    content: `You are LifePilot Aura, a highly intelligent and conversational AI assistant. Your goal is to help the user plan their day.
Currently, you are in the CHAT PHASE. Ask the user about their routine, important meetings, and habits.
CRITICAL INSTRUCTIONS: 
1. If you do not know the user's occupation or main daily focus, proactively ask for it. 
2. Ask the user if they want a "Detailed Planner" (which predicts their whole day including implicit tasks like sleep, meals, and focus blocks) or a "Simple Planner" (just organizing their To-Do list). 

CURRENT MEMORY OF USER:
${currentMemory || "No memory yet."}

CRITICAL: You MUST respond in a strict JSON object format (no markdown). Do not use markdown like \`\`\`json.
Schema:
{
  "reply": "Your conversational response to the user. Keep it friendly and concise.",
  "memory": "Update the CURRENT MEMORY with any new facts you learned (e.g., 'User is a software engineer', 'Wants a Detailed Planner', 'Eats at 2PM'). If nothing changed, return the exact same memory."
}

CURRENT TASK AND CALENDAR CONTEXT:
${systemContext || "No task/calendar context."}` 
  };
  
  const finalMessages = [jsonInstruction, ...chatHistory];

  let rawResponse = '';
  let lastError = null;
  
  try {
    rawResponse = await callGroq(finalMessages, { json: true });
  } catch (e1) {
    console.log('❌ Groq failed:', e1.message);
    lastError = e1;
    try {
      rawResponse = await callGemini(finalMessages, { json: true });
    } catch (e2) {
      console.log('❌ Gemini failed:', e2.message);
      lastError = e2;
      try {
        rawResponse = await callMistral(finalMessages, { json: true });
      } catch (e3) {
        console.log('❌ Mistral failed:', e3.message);
        lastError = e3;
        const errorMsg = lastError?.message || 'Unknown error';
        throw new Error(`All AI services are currently unavailable. Last error: ${errorMsg}`);
      }
    }
  }

  try {
    return parseJsonFromText(rawResponse);
  } catch (_err) {
    console.log('❌ AI Failed to return valid JSON object:', rawResponse);
    // Fallback if AI fails to return JSON
    return { reply: "I'm having trouble thinking clearly. Let's just build your schedule whenever you're ready!", memory: currentMemory, _isFallback: true };
  }
};

export const getCoachAdvice = async (taskTitle, nextTaskInfo, memory) => {
  const finalMessages = [
    { 
      role: 'system', 
      content: `You are an AI Flow Coach. Analyze the user's task and memory. ${nextTaskInfo} 
Suggest an optimal focus duration (in minutes) and a 1-sentence piece of advice. Also, generate a harsh 1-sentence "tough love" quote to guilt-trip them in case they try to quit early.
CRITICAL: Return strict JSON ONLY. No markdown.
Schema: {"minutes": 25, "advice": "Deep work requires 0 distractions. Let's crush this.", "tough_love": "Great things never came from comfort zones. Get back to work!"}
USER MEMORY: ${memory || "None"}`
    },
    { role: 'user', content: `Task: ${taskTitle || 'Custom Session'}` }
  ];

  try {
    let rawResponse = '';
    try {
      rawResponse = await callGemini(finalMessages, { json: true });
    } catch (e1) {
      try {
        rawResponse = await callGroq(finalMessages, { json: true });
      } catch (e2) {
        rawResponse = await callMistral(finalMessages, { json: true });
      }
    }
    return parseJsonFromText(rawResponse);
  } catch (err) {
    console.log('Coach AI error:', err.message);
    return { minutes: 25, advice: "Zero distractions. Let's go.", tough_love: "Quitting is for the weak. Get back to work." };
  }
};
