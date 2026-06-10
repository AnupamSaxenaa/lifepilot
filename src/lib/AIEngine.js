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

  const taskByTitle = new Map(
    tasks
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

const formatTime = (date) => date.toLocaleTimeString('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

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

  if (activeTasks.length === 0) {
    const end = new Date(cursor.getTime() + 45 * 60000);
    return [{
      taskId: null,
      time: `${formatTime(cursor)} - ${formatTime(end)}`,
      title: 'Plan and prioritize today',
      completed: false,
    }];
  }

  return activeTasks.map((task) => {
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
};

const callGemini = async (messages, options = {}) => {
  if (!AI_CONFIG.GEMINI_API_KEY || AI_CONFIG.GEMINI_API_KEY.includes('YOUR_')) throw new Error('Missing Key');
  
  // Convert standard roles to Gemini roles
  const prompt = messages.map(m => {
    const role = m.role === 'user' ? 'User' : (m.role === 'system' ? 'System Instructions' : 'Assistant');
    return `${role}: ${m.content}`;
  }).join('\n\n');

  let lastError;
  for (const model of GEMINI_MODELS) {
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
      lastError = new Error(`Gemini ${model} Error: ${response.status}`);
      continue;
    }

    const data = await response.json();
    if (!data.candidates || data.candidates.length === 0) {
      lastError = new Error(`Gemini ${model} returned empty response`);
      continue;
    }
    
    return data.candidates[0].content.parts[0].text;
  }

  throw lastError || new Error('Gemini failed');
};

const callGroq = async (messages, options = {}) => {
  if (!AI_CONFIG.GROQ_API_KEY || AI_CONFIG.GROQ_API_KEY.includes('YOUR_')) throw new Error('Missing Key');
  
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
        messages,
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
  
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AI_CONFIG.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages,
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
  
  // Convert OpenAI format to Cohere chat history format
  const chatHistory = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'user' ? 'USER' : 'CHATBOT',
    message: m.content
  }));
  
  const lastMessageObj = chatHistory.pop();
  const lastMessage = lastMessageObj ? lastMessageObj.message : 'Plan my day';
  const systemPrompt = messages.find(m => m.role === 'system')?.content || '';

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

  // Extract the system prompt passed from AIAuraOverlay (which is always messages[0])
  const callerSysPrompt = messages.length > 0 && messages[0].role === 'system' ? messages[0].content : '';

  // Merge the instructions into a single System message to prevent Groq/Mistral 400 Errors
  const masterSystemInstruction = { 
    role: 'system', 
    content: `CRITICAL: You must respond ONLY with a raw, valid JSON object. Do not use markdown formatting like \`\`\`json.
Schema: { "schedule": [ { "taskId": "string_or_null", "time": "string (e.g. 9:00 AM - 10:00 AM)", "title": "string" } ] }

RULES:
1. If the user memory indicates they want a "Detailed Plan" or if it is implied, you MUST invent "Implicit Tasks" (e.g., waking up, breakfast, deep work blocks, gym, lunch) based on their occupation and habits.
2. For IMPLICIT TASKS (habits, meals, routines), you MUST set "taskId" to null.
3. For EXPLICIT TASKS provided in the prompt below, you MUST preserve their exact "taskId".

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
    console.log('🤖 Attempting Gemini...');
    rawResponse = await callGemini(finalMessages, { json: true });
  } catch (e1) {
    console.log('❌ Gemini failed:', e1.message);
    try {
      console.log('🤖 Attempting Groq...');
      rawResponse = await callGroq(finalMessages, { json: true });
    } catch (e2) {
      console.log('❌ Groq failed:', e2.message);
      try {
        console.log('🤖 Attempting Mistral...');
        rawResponse = await callMistral(finalMessages, { json: true });
      } catch (e3) {
        console.log('❌ Mistral failed:', e3.message);
        try {
          console.log('🤖 Attempting Cohere Command R...');
          rawResponse = await callCohere(finalMessages);
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
    const parsed = parseJsonFromText(rawResponse);
    return normalizePlan(extractPlanItems(parsed), tasks);
  } catch (_err) {
    console.log('❌ AI Failed to return valid JSON array:', rawResponse);
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

  const systemContext = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n');
  const chatHistory = messages.filter(message => message.role !== 'system');

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
  try {
    rawResponse = await callGemini(finalMessages, { json: true });
  } catch (_e1) {
    try {
      rawResponse = await callGroq(finalMessages, { json: true });
    } catch (_e2) {
      try {
        rawResponse = await callMistral(finalMessages, { json: true });
      } catch (_e3) {
        throw new Error('All AI services are currently unavailable.');
      }
    }
  }

  try {
    return parseJsonFromText(rawResponse);
  } catch (_err) {
    console.log('❌ AI Failed to return valid JSON object:', rawResponse);
    // Fallback if AI fails to return JSON
    return { reply: "I'm having trouble thinking clearly. Let's just build your schedule whenever you're ready!", memory: currentMemory };
  }
};
