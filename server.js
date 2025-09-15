const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const TODO_TEMPLATE = require('./todo-template');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Force fallback mode for testing (set to true to avoid AI API calls)
// To disable: set FORCE_FALLBACK=false in .env or change this line to: const FORCE_FALLBACK = false;
const FORCE_FALLBACK = process.env.FORCE_FALLBACK === 'true' || false; // Currently DISABLED - AI API enabled

// Chat history storage (in production, use Redis or database)
const chatHistory = new Map(); // userId -> conversation history
const MAX_HISTORY_LENGTH = 5; // Maximum messages before summarization

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper functions for chat history management
function getOrCreateUserHistory(userId) {
  if (!chatHistory.has(userId)) {
    chatHistory.set(userId, []);
  }
  return chatHistory.get(userId);
}

function addMessageToHistory(userId, message, isUser = true) {
  const history = getOrCreateUserHistory(userId);
  history.push({
    message,
    isUser,
    timestamp: new Date().toISOString()
  });
  
  // If history exceeds max length, summarize and reset
  if (history.length > MAX_HISTORY_LENGTH) {
    return summarizeAndResetHistory(userId, history);
  }
  
  return null; // No summarization needed
}

async function summarizeAndResetHistory(userId, history) {
  try {
    // Create summary prompt
    const conversationText = history.map(h => 
      `${h.isUser ? 'User' : 'AI'}: ${h.message}`
    ).join('\n');
    
    const summaryPrompt = `Hãy tóm tắt cuộc trò chuyện sau đây giữa user và AI assistant về quản lý thời gian. Tóm tắt ngắn gọn các chủ đề chính, yêu cầu của user, và phản hồi của AI. Giữ lại thông tin quan trọng để AI có thể tiếp tục cuộc trò chuyện một cách tự nhiên.

Cuộc trò chuyện:
${conversationText}

Tóm tắt:`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(summaryPrompt);
    const summary = await result.response.text();
    
    // Reset history with summary
    chatHistory.set(userId, [{
      message: `[TÓM TẮT CUỘC TRÒ CHUYỆN TRƯỚC] ${summary}`,
      isUser: false,
      timestamp: new Date().toISOString()
    }]);
    
    return summary;
  } catch (error) {
    console.error('Error summarizing chat history:', error);
    // If summarization fails, keep only the last 3 messages
    const recentHistory = history.slice(-3);
    chatHistory.set(userId, recentHistory);
    return null;
  }
}

function getHistoryContext(userId) {
  const history = getOrCreateUserHistory(userId);
  if (history.length === 0) return '';
  
  return `LỊCH SỬ CUỘC TRÒ CHUYỆN:
${history.map(h => 
  `${h.isUser ? 'User' : 'AI'}: ${h.message}`
).join('\n')}

---`;
}

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://web-track-naver-vietnam-ai-hackatho-alpha.vercel.app',
  'https://web-track-naver-vietnam-ai-hackatho-alpha.vercel.app/',
  process.env.FRONTEND_URL
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());


app.get("/ping", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "chatbot-backend",
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'AI Chatbot Backend is running' });
});

// Reset chat history endpoint
app.post('/api/chat/reset', (req, res) => {
  try {
    const { userId = 'default' } = req.body;
    
    // Clear history for the user
    if (chatHistory.has(userId)) {
      chatHistory.delete(userId);
      console.log(`🗑️ Chat history reset for user ${userId}`);
    }
    
    res.json({
      success: true,
      message: 'Chat history reset successfully',
      userId: userId
    });
  } catch (error) {
    console.error('Error resetting chat history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset chat history'
    });
  }
});

// Create task/event endpoint
app.post('/api/tasks/create', (req, res) => {
  try {
    const { taskData, userId = 'default' } = req.body;
    
    if (!taskData) {
      return res.status(400).json({
        success: false,
        error: 'Task data is required'
      });
    }
    
    // Validate required fields
    const requiredFields = ['title', 'category', 'type'];
    const missingFields = requiredFields.filter(field => !taskData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }
    
    // Generate unique ID
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create complete task object
    const newTask = {
      id: taskId,
      title: taskData.title,
      description: taskData.description || '',
      category: taskData.category,
      type: taskData.type,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: taskData.tags || [],
      procrastinationScore: taskData.procrastinationScore || 1,
      
      // Task-specific fields
      ...(taskData.type === 'task' && {
        priority: taskData.priority || 'medium',
        dueDate: taskData.dueDate,
        estimatedDuration: taskData.estimatedDuration || 60,
        actualDuration: taskData.actualDuration || null,
        status: taskData.status || 'pending'
      }),
      
      // Event-specific fields
      ...(taskData.type === 'event' && {
        startTime: taskData.startTime,
        endTime: taskData.endTime,
        location: taskData.location || '',
        isRecurring: taskData.isRecurring || false,
        recurrencePattern: taskData.recurrencePattern || null,
        recurrenceEndDate: taskData.recurrenceEndDate || null
      })
    };
    
    console.log(`✅ Task created successfully: ${newTask.title} (${newTask.type})`);
    
    res.json({
      success: true,
      task: newTask,
      message: `${newTask.type === 'task' ? 'Task' : 'Event'} created successfully`,
      userId: userId
    });
    
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create task'
    });
  }
});


// AI Recommendations endpoint
app.post('/api/analytics/recommendations', async (req, res) => {
  try {
    const { tasks, taskStats, timeAccuracy, language = 'vi' } = req.body;

    if (!tasks || !taskStats) {
      return res.status(400).json({ error: 'Tasks and taskStats are required' });
    }

    // Extract heatmap data from taskStats if available
    const heatmapData = taskStats.heatmapData || null;
    const heatmapAnalysis = taskStats.heatmapAnalysis || null;
    const weeklyEventTime = taskStats.weeklyEventTime || 0;


    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Create analytics context with heatmap data
    const analyticsContext = createAnalyticsContext(tasks, taskStats, timeAccuracy, {
      heatmapData,
      heatmapAnalysis,
      weeklyEventTime
    });
    
      
    
    // Check if we should force fallback (only when explicitly enabled)
    if (FORCE_FALLBACK) {
      const reason = 'FORCE_FALLBACK mode enabled';
      console.log(`🔧 Using FALLBACK recommendations - Reason: ${reason}`);
      
      const fallbackRecommendations = generateFallbackRecommendations(tasks, taskStats, timeAccuracy, language);
      
      res.json({
        success: true,
        recommendations: fallbackRecommendations,
        timestamp: new Date().toISOString(),
        note: `Using fallback recommendations due to: ${reason}`,
        debug: {
          forceFallback: FORCE_FALLBACK,
          totalTasks: analyticsContext.totalTasks
        }
      });
      return;
    }
    
    // Create prompt for recommendations
    const prompt = createRecommendationsPrompt(analyticsContext, language);
    console.log(`🤖 Using AI API for recommendations`);

    try {
      // Generate response with timeout
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI API timeout after 30 seconds')), 30000)
        )
      ]);
    const response = await result.response;
    const aiResponse = response.text();

    // Parse the response into structured recommendations
    const recommendations = parseRecommendations(aiResponse, language);

    res.json({
      success: true,
      recommendations,
      timestamp: new Date().toISOString()
    });
    } catch (aiError) {
      console.log(`🔧 AI API failed, using FALLBACK recommendations - Error: ${aiError.message}`);
      
      // Fallback recommendations if AI fails
      const fallbackRecommendations = generateFallbackRecommendations(tasks, taskStats, timeAccuracy, language);
      
      res.json({
        success: true,
        recommendations: fallbackRecommendations,
        timestamp: new Date().toISOString(),
        note: 'Using fallback recommendations due to AI API error'
      });
    }

  } catch (error) {
    
    // Fallback recommendations
    const fallbackRecommendations = generateFallbackRecommendations(req.body.tasks, req.body.taskStats, req.body.timeAccuracy, req.body.language);
    
    res.json({
      success: true,
      recommendations: fallbackRecommendations,
      timestamp: new Date().toISOString(),
      note: 'Using fallback recommendations due to API error'
    });
  }
});

// AI Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, tasks, taskStats, userId = 'default' } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Add user message to history
    const summaryResult = addMessageToHistory(userId, message, true);
    
    // If history was summarized, log it
    if (summaryResult) {
      console.log(`📝 Chat history summarized for user ${userId}:`, summaryResult.substring(0, 100) + '...');
    }

    // Extract heatmap data from taskStats if available
    const heatmapData = taskStats?.heatmapData || null;
    const heatmapAnalysis = taskStats?.heatmapAnalysis || null;

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Create context from tasks with heatmap data
    const tasksContext = createTasksContext(tasks || [], { heatmapData, heatmapAnalysis });
    
    
    // Force fallback for chat as well if enabled
    if (FORCE_FALLBACK) {
      const fallbackResponse = generateFallbackResponse(message, tasks || []);
      
      // Add fallback response to history
      addMessageToHistory(userId, fallbackResponse, false);
      
      res.json({
        success: true,
        response: fallbackResponse,
        timestamp: new Date().toISOString(),
        note: 'Using fallback response due to FORCE_FALLBACK mode',
        debug: {
          forceFallback: FORCE_FALLBACK,
          totalTasks: tasksContext.totalTasks
        }
      });
      return;
    }
    
    // Get history context
    const historyContext = getHistoryContext(userId);
    
    // Create prompt for Gemini with history
    const prompt = createPrompt(message, tasksContext, historyContext);
    
    // Log prompt for debugging
    console.log('📝 AI Prompt Debug:');
    console.log('User Message:', message);
    console.log('Tasks Context Summary:');
    console.log('- Total Tasks:', tasksContext.totalTasks);
    console.log('- Total Events:', tasksContext.totalEvents || 0);
    console.log('- Completed Tasks:', tasksContext.completedTasks);
    console.log('- Has Heatmap:', !!tasksContext.heatmapData);
    console.log('- Full Context:', JSON.stringify(tasksContext, null, 2));
    console.log('History Context Length:', historyContext.length);
    console.log('Prompt Length:', prompt.length);
    console.log('Contains JSON examples:', prompt.includes('create_task'));
    console.log('Contains system prompt:', prompt.includes('Bạn là AI assistant'));
    
    console.log(`🤖 Using AI API for chat response`);

    // Generate response with timeout
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI API timeout after 30 seconds')), 30000)
      )
    ]);
    const response = await result.response;
    const aiResponse = response.text();

    // Log AI response format for debugging
    console.log('🤖 AI Response Format Debug:');
    console.log('Raw AI Response:', aiResponse);
    console.log('Response Length:', aiResponse.length);
    console.log('Contains JSON:', aiResponse.includes('```json'));
    console.log('Contains create_task:', aiResponse.includes('create_task'));
    console.log('Contains action:', aiResponse.includes('"action"'));
    
    // Try to extract JSON if present
    const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const jsonData = JSON.parse(jsonMatch[1]);
        console.log('📋 Extracted JSON Data:', JSON.stringify(jsonData, null, 2));
        console.log('JSON Action:', jsonData.action);
        if (jsonData.taskData) {
          console.log('Task Type:', jsonData.taskData.type);
          console.log('Task Title:', jsonData.taskData.title);
        }
      } catch (e) {
        console.log('❌ Failed to parse JSON:', e.message);
      }
    } else {
      console.log('ℹ️ No JSON found in response');
    }

    // Add AI response to history
    addMessageToHistory(userId, aiResponse, false);

    res.json({
      success: true,
      response: aiResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.log(`🔧 Using FALLBACK chat response - API Error: ${error.message}`);
    
    // Fallback response if Gemini API fails
    const fallbackResponse = generateFallbackResponse(req.body.message, req.body.tasks);
    
    // Add fallback response to history
    addMessageToHistory(req.body.userId || 'default', fallbackResponse, false);
    
    res.json({
      success: true,
      response: fallbackResponse,
      timestamp: new Date().toISOString(),
      note: 'Using fallback response due to API error'
    });
  }
});

// Helper function to create analytics context
function createAnalyticsContext(tasks, taskStats, timeAccuracy, heatmapInfo = null) {
  // Separate events and tasks
  const events = tasks.filter(item => item.type === 'event');
  const taskItems = tasks.filter(item => item.type === 'task' || !item.type);
  
  const totalEvents = events.length;
  const totalTasks = taskItems.length;
  const totalItems = totalEvents + totalTasks;
  
  const completedTasks = taskStats.completedTasks || 0;
  const overdueTasks = taskStats.overdueTasks || 0;
  const productivityScore = taskStats.productivityScore || 0;
  const averageCompletionTime = taskStats.averageCompletionTime || 0;
  const timeEstimationAccuracy = timeAccuracy?.accuracy || 0;
  const averageOverrun = timeAccuracy?.averageOverrun || 0;

  // Heatmap data
  const heatmapData = heatmapInfo?.heatmapData || null;
  const heatmapAnalysis = heatmapInfo?.heatmapAnalysis || null;
  const weeklyEventTime = heatmapInfo?.weeklyEventTime || 0;

  // Category breakdown - combine events and tasks
  const allItems = [...events, ...taskItems];
  const categories = ['academic', 'work', 'personal', 'health', 'social'];
  const categoryStats = categories.map(category => {
    const categoryItems = allItems.filter(item => item.category === category);
    const total = categoryItems.length;
    return `${category},${total}`;
  });
  
  // Priority breakdown - only for tasks (events don't have priority)
  const priorities = ['urgent', 'high', 'medium', 'low'];
  const priorityStats = priorities.map(priority => {
    const priorityTasks = taskItems.filter(task => task.priority === priority);
    const completed = priorityTasks.filter(task => task.status === 'completed').length;
    const total = priorityTasks.length;
    const completionRate = total > 0 ? (completed / total) * 100 : 0;
    
    // Get deadlines for this priority
    const deadlines = priorityTasks
      .filter(task => task.dueDate && task.dueDate !== null && task.dueDate !== undefined)
      .map(task => {
        const dueDate = new Date(task.dueDate);
        const day = dueDate.getDate();
        const month = dueDate.getMonth() + 1;
        const year = dueDate.getFullYear();
        const hours = dueDate.getHours().toString().padStart(2, '0');
        const minutes = dueDate.getMinutes().toString().padStart(2, '0');
        const seconds = dueDate.getSeconds().toString().padStart(2, '0');
        const milliseconds = dueDate.getMilliseconds();
        return `${hours}:${minutes}:${seconds}.${milliseconds}:${day}.${month}:${year}`;
      });
    
    const deadlineString = deadlines.length > 0 ? deadlines.join(',') : '';
    return `${priority},${total},${completed},${Math.round(completionRate)},${deadlineString}`;
  });

  // Use weeklyEventTime from heatmapInfo parameter (calculated in frontend)

  return {
    totalEvents,
    totalTasks,
    totalItems,
    completedTasks,
    overdueTasks,
    productivityScore,
    averageCompletionTime,
    timeEstimationAccuracy,
    averageOverrun,
    categoryStats,
    priorityStats,
    weeklyEventTime,
    completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
    events: events, // Add events to context
    tasks: taskItems, // Add tasks to context for deadline checking
    // Heatmap data
    heatmapData,
    heatmapAnalysis
  };
}

// Helper function to create recommendations prompt
function createRecommendationsPrompt(context, language) {
  const isVietnamese = language === 'vi';
  
    if (isVietnamese) {
      return `Bạn là AI Assistant chuyên về phân tích và đưa ra khuyến nghị quản lý thời gian cho sinh viên đại học Việt Nam.

BỐI CẢNH QUAN TRỌNG:
- Đây là dành cho HỌC SINH/SINH VIÊN, không phải người đi làm
- Tránh khuyến nghị giờ học/làm việc không phù hợp với học sinh (ví dụ: giờ khuya như 11PM-2AM, giờ sáng sớm như 4AM-6AM)
- Cân nhắc lối sống điển hình của học sinh: học trên lớp ban ngày, học thêm buổi tối, lịch ngủ hợp lý
- Tập trung vào khung giờ thực tế: 7AM-10PM cho các hoạt động học tập
- Chú ý đến sức khỏe và cân bằng cuộc sống của học sinh

THÔNG TIN CỦA USER:
Total Events: ${context.totalEvents}
Total Tasks: ${context.totalTasks}
Total Items: ${context.totalItems}
Completed Tasks: ${context.completedTasks}
Overdue Tasks: ${context.overdueTasks}
Productivity Score: ${context.productivityScore}
Completion Rate: ${context.completionRate}
Weekly Event Time: ${context.weeklyEventTime}

${context.heatmapData && typeof context.heatmapData === 'object' ? `Heatmap Data (Tháng hiện tại):
${(() => {
  const dayNames = { 'Mon': 'Thứ 2', 'Tue': 'Thứ 3', 'Wed': 'Thứ 4', 'Thu': 'Thứ 5', 'Fri': 'Thứ 6', 'Sat': 'Thứ 7', 'Sun': 'Chủ nhật' };
  const dayGroups = {};
  
  Object.keys(context.heatmapData).forEach(key => {
    const [dayKey, hour] = key.split('_');
    const dayName = dayNames[dayKey] || dayKey;
    const count = context.heatmapData[key];
    
    if (!dayGroups[dayName]) {
      dayGroups[dayName] = [];
    }
    
    if (count > 0) {
      dayGroups[dayName].push(`${hour}:00-${parseInt(hour) + 1}:00:${count}`);
    }
  });
  
  return Object.keys(dayGroups).map(day => {
    if (dayGroups[day].length > 0) {
      return `${day}: ${dayGroups[day].join(', ')}`;
    }
    return '';
  }).filter(line => line).join('\n');
})()}` : ''}

Category Stats: ${JSON.stringify(context.categoryStats)}
Priority Stats: ${JSON.stringify(context.priorityStats)}

GIẢI THÍCH FORMAT DỮ LIỆU:
- Events: Lịch cố định (đi học, đi làm, họp) - không có deadline
- Tasks: Công việc cần hoàn thành có deadline
- Heatmap Data: Format "Thứ 2: 8:00-9:00:3" = Thứ 2 từ 8:00-9:00 có 3 events/tasks
- Category Stats: Format ["academic,23"] = category "academic" có 23 items
- Priority Stats: Format ["urgent,2,0,0,23:59:00.0:25.9:2025,23:59:00.0:26.9:2025"] = priority "urgent" có 2 tasks, 0 hoàn thành, 0% completion rate, có 2 deadlines (23:59:00.0:25.9:2025 = 23:59:00 ngày 25/9/2025)
- Weekly Event Time: Tổng thời gian (phút) của tất cả events trong tuần
- Productivity Score: Điểm năng suất từ 0-100%
- Completion Rate: Tỷ lệ hoàn thành tasks từ 0-100%

NHIỆM VỤ: Phân tích dữ liệu trên và đưa ra khuyến nghị theo các tiêu chí sau:

1. VỀ VIỆC SỬ DỤNG THỜI GIAN HỌC TẬP VÀ LÀM VIỆC TRONG TUẦN (chỉ tính Event, không tính Task deadline)
2. VỀ DEADLINE (nếu có tasks quá hạn)
3. NHẬN XÉT/ĐÁNH GIÁ VỀ SỞ THÍCH CỦA NGƯỜI DÙNG BẰNG CATEGORY
4. GỢI Ý CỤ THỂ DỰA TRÊN DỮ LIỆU HEATMAP:
   - Nếu thấy thời gian sắp xếp ổn: "Thời gian sắp xếp của bạn khá hợp lý, hãy tiếp tục duy trì"
   - Nếu có khung giờ trống nhiều: Đưa ra đề xuất cụ thể với thời gian và nội dung (VD: "Bạn có thể thêm việc học tiếng Anh vào lúc 8:00-9:00 Thứ 2 hàng tuần để cải thiện kỹ năng")
   - Nếu có thời gian quá bận: Cảnh báo và đề xuất giảm tải
   - Sử dụng giờ vàng cho nhiệm vụ quan trọng với thời gian cụ thể
   - Đề xuất thay đổi lịch dựa trên pattern thời gian

YÊU CẦU TRẢ LỜI:
- Trả lời như một người bạn thân thiện, quan tâm đến việc học tập của bạn
- Sử dụng ngôn ngữ gần gũi, dễ hiểu, không quá trang trọng
- Đưa ra lời khuyên thực tế, có thể áp dụng ngay
- Khuyến khích và động viên thay vì chỉ trích
- Mỗi phần 2-3 câu, ngắn gọn nhưng đầy đủ ý nghĩa
- QUAN TRỌNG: KHÔNG sử dụng dấu ** (markdown formatting), chỉ dùng text thuần túy

ĐỊNH DẠNG TRẢ LỜI:
⏰ Thời gian: [Đánh giá nhẹ nhàng về cách sử dụng thời gian, gợi ý cải thiện một cách tích cực]
📅 Deadline: [Nhắc nhở về deadlines một cách quan tâm, đưa ra lời khuyên thực tế]
🎯 Sở thích: [Nhận xét về xu hướng học tập/làm việc một cách tích cực, gợi ý cân bằng]
💡 Gợi ý: [Đưa ra những biện pháp cụ thể để giải quyết những vấn đề nếu có xuất hiện ở trên, như một người bạn đang tư vấn]`
  }

  return `You are an AI Assistant specialized in time management analysis and recommendations for Vietnamese university students.

IMPORTANT CONTEXT:
- This is for STUDENTS/UNIVERSITY STUDENTS, not working professionals
- Avoid recommending study/work hours that are inappropriate for students (e.g., very late night hours like 11PM-2AM, very early morning like 4AM-6AM)
- Consider typical student lifestyle: classes during day, some evening study, reasonable sleep schedule
- Focus on realistic time slots: 7AM-10PM for academic activities
- Be mindful of student health and work-life balance

USER DATA:
Total Events: ${context.totalEvents}
Total Tasks: ${context.totalTasks}
Total Items: ${context.totalItems}
Completed Tasks: ${context.completedTasks}
Overdue Tasks: ${context.overdueTasks}
Productivity Score: ${context.productivityScore}
Completion Rate: ${context.completionRate}
Weekly Event Time: ${context.weeklyEventTime}

${context.heatmapData && typeof context.heatmapData === 'object' ? `Heatmap Data (Current Month):
${(() => {
  const dayNames = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday' };
  const dayGroups = {};
  
  Object.keys(context.heatmapData).forEach(key => {
    const [dayKey, hour] = key.split('_');
    const dayName = dayNames[dayKey] || dayKey;
    const count = context.heatmapData[key];
    
    if (!dayGroups[dayName]) {
      dayGroups[dayName] = [];
    }
    
    if (count > 0) {
      dayGroups[dayName].push(`${hour}:00-${parseInt(hour) + 1}:00:${count}`);
    }
  });
  
  return Object.keys(dayGroups).map(day => {
    if (dayGroups[day].length > 0) {
      return `${day}: ${dayGroups[day].join(', ')}`;
    }
    return '';
  }).filter(line => line).join('\n');
})()}` : ''}

Category Stats: ${JSON.stringify(context.categoryStats)}
Priority Stats: ${JSON.stringify(context.priorityStats)}

DATA FORMAT EXPLANATION:
- Events: Fixed schedules (school, work, meetings) - no deadlines
- Tasks: Work items that need to be completed with deadlines
- Heatmap Data: Format "Monday: 8:00-9:00:3" = Monday from 8:00-9:00 has 3 events/tasks
- Category Stats: Format ["academic,23"] = category "academic" has 23 items
- Priority Stats: Format ["urgent,2,0,0,23:59:00.0:25.9:2025,23:59:00.0:26.9:2025"] = priority "urgent" has 2 tasks, 0 completed, 0% completion rate, has 2 deadlines (23:59:00.0:25.9:2025 = 23:59:00 on 25/9/2025)
- Weekly Event Time: Total time (minutes) of all events in the week
- Productivity Score: Productivity score from 0-100%
- Completion Rate: Task completion rate from 0-100%

TASK: Analyze the above data and provide recommendations based on these criteria:

1. WEEKLY STUDY AND WORK TIME USAGE (only count Events, not Task deadlines)
2. DEADLINE ANALYSIS (if there are overdue tasks)
3. USER PREFERENCES ANALYSIS BY CATEGORY
4. SPECIFIC SUGGESTIONS BASED ON HEATMAP DATA:
   - If time arrangement is good: "Your time arrangement is quite reasonable, keep maintaining it"
   - If many free time slots: Provide specific suggestions with time and content (e.g., "You can add English learning from 8:00-9:00 every Monday to improve skills")
   - If too busy periods: Warn and suggest reducing workload
   - Utilize golden hours for important tasks with specific times
   - Propose schedule changes based on time patterns

RESPONSE REQUIREMENTS:
- Respond like a caring friend who wants to help with studies
- Use warm, approachable language that's easy to understand
- Give practical advice that can be applied immediately
- Encourage and motivate rather than criticize
- Each section 2-3 sentences, concise but meaningful
- IMPORTANT: DO NOT use ** (markdown formatting), use plain text only

RESPONSE FORMAT:
⏰ Time: [Gentle assessment of time usage, positive suggestions for improvement]
📅 Deadline: [Caring reminders about deadlines, practical advice]
🎯 Preferences: [Positive observations about study/work patterns, balance suggestions]
💡 Suggestions: [Specific solutions to address any problems identified above, like a friend giving advice]`;
}

// Helper function to parse recommendations
function parseRecommendations(aiResponse, language) {
  const recommendations = [];
  const lines = aiResponse.split('\n').filter(line => line.trim());
  
  // Parse new format: "Thời gian: [content]"
  for (const line of lines) {
    if (line.includes(':') && (
      line.includes('Thời gian:') || 
      line.includes('Deadline:') || 
      line.includes('Sở thích:') || 
      line.includes('Gợi ý:') ||
      line.includes('Quản lý thời gian:') || 
      line.includes('Tối ưu lịch trình:') ||
      line.includes('Công cụ:') ||
      line.includes('Kỹ thuật:') ||
      line.includes('Time:') ||
      line.includes('Preferences:') ||
      line.includes('Suggestions:') ||
      line.includes('Time Management:') ||
      line.includes('Schedule Optimization:') ||
      line.includes('Tools:') ||
      line.includes('Technique:')
    )) {
      recommendations.push(line.trim());
    }
  }
  
  // If no structured recommendations found, try old format
  if (recommendations.length === 0) {
    for (const line of lines) {
      if (line.includes('🎯') || line.includes('⚡') || line.includes('💡') || line.includes('🌟')) {
        recommendations.push(line.trim());
      }
    }
  }
  
  // If still no recommendations found, create fallback
  if (recommendations.length === 0) {
    return generateFallbackRecommendations([], {}, {}, language);
  }
  
  return recommendations;
}

// Helper function to create tasks context
function createTasksContext(tasks, heatmapInfo = null) {
  if (!tasks || tasks.length === 0) {
    return {
      totalTasks: 0,
      pendingTasks: 0,
      inProgressTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
      urgentTasks: 0,
      highPriorityTasks: 0,
      upcomingDeadlines: [],
      heatmapData: heatmapInfo?.heatmapData || null,
      heatmapAnalysis: heatmapInfo?.heatmapAnalysis || null
    };
  }

  // Separate events and tasks
  const events = tasks.filter(t => t.type === 'event');
  const taskItems = tasks.filter(t => t.type === 'task');

  const totalTasks = tasks.length;
  const totalEvents = events.length;
  const totalItems = totalTasks;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const overdueTasks = tasks.filter(t => 
    t.type !== 'event' && t.status !== 'completed' && new Date(t.dueDate || '') < new Date()
  ).length;

  const urgentTasks = tasks.filter(t => t.priority === 'urgent').length;
  const highPriorityTasks = tasks.filter(t => t.priority === 'high').length;

  // Calculate productivity score and completion rate
  const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Calculate weekly event time
  const weeklyEventTime = events.reduce((total, event) => {
    if (event.estimatedDuration) {
      return total + event.estimatedDuration;
    }
    return total;
  }, 0);

  // Create category stats
  const categoryStats = [];
  const categoryCount = {};
  tasks.forEach(task => {
    const category = task.category || 'other';
    categoryCount[category] = (categoryCount[category] || 0) + 1;
  });
  Object.keys(categoryCount).forEach(category => {
    categoryStats.push(`${category},${categoryCount[category]}`);
  });

  // Create priority stats
  const priorityStats = [];
  const priorityCount = {};
  tasks.forEach(task => {
    const priority = task.priority || 'none';
    if (!priorityCount[priority]) {
      priorityCount[priority] = { total: 0, completed: 0, deadlines: [] };
    }
    priorityCount[priority].total++;
    if (task.status === 'completed') {
      priorityCount[priority].completed++;
    }
    if (task.dueDate) {
      priorityCount[priority].deadlines.push(task.dueDate);
    }
  });
  Object.keys(priorityCount).forEach(priority => {
    const data = priorityCount[priority];
    const completionRate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
    const deadlineStr = data.deadlines.length > 0 ? data.deadlines.join(',') : '';
    priorityStats.push(`${priority},${data.total},${data.completed},${completionRate},${deadlineStr}`);
  });

  const upcomingDeadlines = tasks
    .filter(t => t.status !== 'completed')
    .sort((a, b) => {
      const dateA = new Date(a.type === 'event' ? (a.startTime || a.dueDate || '') : (a.dueDate || ''));
      const dateB = new Date(b.type === 'event' ? (b.startTime || b.dueDate || '') : (b.dueDate || ''));
      return dateA.getTime() - dateB.getTime();
    })
    .slice(0, 5)
    .map(t => ({
      title: t.title,
      dueDate: t.type === 'event' ? (t.startTime || t.dueDate || '') : (t.dueDate || ''),
      priority: t.priority || 'none',
      category: t.category,
      type: t.type
    }));

  return {
    totalTasks,
    totalEvents,
    totalItems,
    pendingTasks,
    inProgressTasks,
    completedTasks,
    overdueTasks,
    urgentTasks,
    highPriorityTasks,
    productivityScore,
    completionRate,
    weeklyEventTime,
    categoryStats,
    priorityStats,
    upcomingDeadlines,
    heatmapData: heatmapInfo?.heatmapData || null,
    heatmapAnalysis: heatmapInfo?.heatmapAnalysis || null
  };
}

// Helper function to create prompt for Gemini
function createPrompt(userMessage, tasksContext, historyContext = '') {
  // Get current date and time in VN timezone
  const now = new Date();
  const vnTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  
  // Get VN date components
  const vnYear = vnTime.getFullYear();
  const vnMonth = String(vnTime.getMonth() + 1).padStart(2, '0');
  const vnDay = String(vnTime.getDate()).padStart(2, '0');
  const currentDate = `${vnYear}-${vnMonth}-${vnDay}`; // YYYY-MM-DD in VN timezone
  
  const currentTime = vnTime.toTimeString().split(' ')[0]; // HH:MM:SS
  const currentDayName = vnTime.toLocaleDateString('vi-VN', { weekday: 'long' }); // Thứ Hai, Thứ Ba, etc.
  const currentDateVN = vnTime.toLocaleDateString('vi-VN'); // DD/MM/YYYY
  
  // Calculate tomorrow in VN timezone
  const tomorrowVN = new Date(vnTime);
  tomorrowVN.setDate(vnTime.getDate() + 1);
  const tomorrowYear = tomorrowVN.getFullYear();
  const tomorrowMonth = String(tomorrowVN.getMonth() + 1).padStart(2, '0');
  const tomorrowDay = String(tomorrowVN.getDate()).padStart(2, '0');
  const tomorrowDate = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`; // YYYY-MM-DD in VN timezone
  
  return `Bạn là AI Assistant chuyên về quản lý thời gian cho sinh viên đại học Việt Nam - mặc định tên sẽ là N-Timer AI.

THÔNG TIN THỜI GIAN HIỆN TẠI (THEO GIỜ VIỆT NAM):
- Hôm nay là: ${currentDayName}, ${currentDateVN}
- Ngày hiện tại (ISO): ${currentDate}
- Ngày mai (ISO): ${tomorrowDate}
- Giờ hiện tại: ${currentTime}
- Timezone: Asia/Ho_Chi_Minh (UTC+7)

${historyContext}

THÔNG TIN LỊCH TRÌNH HIỆN TẠI CỦA USER:
- Tổng số sự kiện: ${tasksContext.totalEvents || 0}
- Tổng số công việc: ${tasksContext.totalTasks}
- Tổng số mục: ${tasksContext.totalItems || tasksContext.totalTasks}
- Công việc đã hoàn thành: ${tasksContext.completedTasks}
- Công việc quá hạn: ${tasksContext.overdueTasks}
- Điểm năng suất: ${tasksContext.productivityScore || 0}%
- Tỷ lệ hoàn thành: ${tasksContext.completionRate || 0}%
- Thời gian sự kiện hàng tuần: ${tasksContext.weeklyEventTime || 0} phút

QUAN TRỌNG: 
- Bạn ĐÃ CÓ thông tin về lịch trình của user ở trên
- ĐỪNG nói "mình chưa biết gì" hay "mình chưa biết lịch của bạn"
- ĐỪNG nói "hiện tại mình chưa biết gì cả"
- Hãy sử dụng thông tin này để đưa ra lời khuyên phù hợp
- Nếu user có ${tasksContext.totalTasks} công việc và ${tasksContext.totalEvents || 0} sự kiện, hãy dựa vào đó để tư vấn
- Nếu user có heatmap data, hãy phân tích thời gian bận/rảnh của họ

${tasksContext.heatmapData && typeof tasksContext.heatmapData === 'object' ? `Heatmap Data (Current Month):
${(() => {
  const dayNames = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday' };
  const dayGroups = {};
  
  Object.keys(tasksContext.heatmapData).forEach(key => {
    const [dayKey, hour] = key.split('_');
    const dayName = dayNames[dayKey] || dayKey;
    const count = tasksContext.heatmapData[key];
    
    if (!dayGroups[dayName]) {
      dayGroups[dayName] = [];
    }
    
    if (count > 0) {
      dayGroups[dayName].push(`${hour}:00-${parseInt(hour) + 1}:00:${count}`);
    }
  });
  
  return Object.keys(dayGroups).map(day => {
    if (dayGroups[day].length > 0) {
      return `${day}: ${dayGroups[day].join(', ')}`;
    }
    return '';
  }).filter(line => line).join('\n');
})()}` : ''}

Category Stats: ${JSON.stringify(tasksContext.categoryStats || [])}
Priority Stats: ${JSON.stringify(tasksContext.priorityStats || [])}

DATA FORMAT EXPLANATION:
- Events: Fixed schedules (school, work, meetings) - no deadlines
- Tasks: Work items that need to be completed with deadlines
- Heatmap Data: Format "Monday: 8:00-9:00:3" = Monday from 8:00-9:00 has 3 events/tasks
- Category Stats: Format ["academic,23"] = category "academic" has 23 items
- Priority Stats: Format ["urgent,2,0,0,23:59:00.0:25.9:2025,23:59:00.0:26.9:2025"] = priority "urgent" has 2 tasks, 0 completed, 0% completion rate, has 2 deadlines (23:59:00.0:25.9:2025 = 23:59:00 on 25/9/2025)
- Weekly Event Time: Total time (minutes) of all events in the week
- Productivity Score: Productivity score from 0-100%
- Completion Rate: Task completion rate from 0-100%

CÂU HỎI: ${userMessage}

BỐI CẢNH QUAN TRỌNG:
- Đây là dành cho HỌC SINH/SINH VIÊN, không phải người đi làm
- Tránh khuyến nghị giờ học/làm việc không phù hợp với học sinh (ví dụ: giờ khuya như 11PM-2AM, giờ sáng sớm như 4AM-6AM)
- Cân nhắc lối sống điển hình của học sinh: học trên lớp ban ngày, học thêm buổi tối, lịch ngủ hợp lý
- Tập trung vào khung giờ thực tế: 7AM-10PM cho các hoạt động học tập
- Chú ý đến sức khỏe và cân bằng cuộc sống của học sinh

HƯỚNG DẪN TRẢ LỜI:
- Trả lời như một người bạn thân thiện, quan tâm đến việc học tập
- Sử dụng ngôn ngữ gần gũi, dễ hiểu, không quá trang trọng
- Đưa ra lời khuyên thực tế, có thể áp dụng ngay
- Khuyến khích và động viên thay vì chỉ trích
- Trả lời tự nhiên dựa trên câu hỏi của user, không cần theo format cố định
- Sử dụng thông tin thời gian bận/rảnh để gợi ý thời gian cụ thể khi phù hợp
- QUAN TRỌNG: KHÔNG sử dụng dấu ** (markdown formatting), chỉ dùng text thuần túy
- KHI USER MUỐN TẠO TASK/EVENT: 
  + Bước 1: Phân tích yêu cầu của user
  + Bước 2: Kiểm tra xem có đủ thông tin không
  + Bước 3: Nếu thiếu thông tin quan trọng, hỏi user
  + Bước 4: Nếu đủ thông tin, tạo JSON ngay lập tức
  + Bước 5: Tự động điền các giá trị mặc định hợp lý

- PHÂN BIỆT EVENT VÀ TASK:
  + EVENT: Sự kiện cố định có giờ bắt đầu và kết thúc (lịch học, lịch đi làm, họp, meeting)
  + TASK: Công việc cần hoàn thành có deadline (làm bài tập, viết báo cáo, deadline)

- KHI NÀO TẠO JSON:
  + EVENT: Khi có tên + thời gian bắt đầu + thời gian kết thúc (hoặc duration)
  + TASK: Khi có tên + deadline
  + Nếu thiếu thông tin quan trọng, hỏi user trước khi tạo JSON
  + Nếu đủ thông tin, tạo JSON ngay lập tức

- KHI NÀO CHỈNH SỬA:
  + Nếu user nói "sửa", "đổi", "thay đổi", "cập nhật" + tên event/task
  + Nếu có đủ thông tin thay đổi, tạo JSON update ngay
  + Nếu thiếu thông tin, hỏi user muốn sửa gì

- KHI NÀO XÓA:
  + Nếu user nói "xóa", "hủy", "bỏ" + tên event/task
  + Tạo JSON delete ngay lập tức
  + Không cần hỏi thêm thông tin
  
- VÍ DỤ KHI NÀO TẠO JSON:
  + ✅ "tạo lịch học toán vào trưa mai lúc 11:00" → Tạo JSON ngay (có tên + thời gian)
  + ✅ "tạo deadline làm bài tập sáng mai" → Tạo JSON ngay (có tên + deadline)
  + ✅ "tự tạo lịch học tiếng Anh dựa theo data của mình" → Tự thiết kế và tạo JSON
  + ✅ "thiết kế lịch học cho mình" → Tự thiết kế và tạo JSON
  + ✅ "tạo lịch học dựa trên lịch hiện tại" → Tự thiết kế và tạo JSON
  + ❌ "tạo lịch học toán" → Hỏi thêm: "Bạn muốn học vào lúc nào?"
  + ❌ "tạo deadline làm bài tập" → Hỏi thêm: "Deadline là khi nào?"
  + ❌ "tạo lịch học toán vào trưa mai" → Hỏi thêm: "Bạn muốn học từ mấy giờ đến mấy giờ?"

- VÍ DỤ KHI NÀO CHỈNH SỬA:
  + ✅ "sửa lịch học toán" → Hỏi: "Bạn muốn sửa gì? (thời gian, tên, mô tả)"
  + ✅ "đổi giờ học toán từ 7:00 thành 8:00" → Tạo JSON update
  + ✅ "thay đổi lịch học tiếng Anh" → Hỏi: "Bạn muốn thay đổi gì?"
  + ✅ "cập nhật deadline bài tập" → Hỏi: "Bạn muốn cập nhật gì?"

- VÍ DỤ KHI NÀO XÓA:
  + ✅ "xóa lịch học toán" → Tạo JSON delete
  + ✅ "hủy lịch học tiếng Anh" → Tạo JSON delete
  + ✅ "xóa deadline bài tập" → Tạo JSON delete
  + ✅ "bỏ lịch học lý" → Tạo JSON delete
  
- CÁCH PHÂN TÍCH THÔNG TIN TỪ USER REQUEST:
  + Tìm từ khóa tạo: "tạo", "lịch", "deadline", "task", "event"
  + Tìm từ khóa chỉnh sửa: "sửa", "đổi", "thay đổi", "cập nhật", "chỉnh sửa", "sửa đổi"
  + Tìm từ khóa xóa: "xóa", "hủy", "bỏ", "xóa bỏ", "hủy bỏ", "xóa đi"
  + Tìm tên: "toán", "lý", "hóa", "bài tập", "báo cáo", "tiếng Anh"
  + Tìm thời gian: "trưa mai", "sáng mai", "tối mai", "hôm nay", "ngày mai"
  + Tìm giờ cụ thể: "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00", "09:00", "10:00"
  + Tìm duration: "1 giờ", "2 giờ", "1.5 giờ", "90 phút", "120 phút"
  + Tìm địa điểm: "phòng học", "thư viện", "nhà", "trường"
  + Tìm từ khóa tự thiết kế: "tự tạo", "thiết kế", "dựa theo", "dựa trên", "theo data", "theo lịch"
  
- TỰ ĐỘNG ĐIỀN CÁC GIÁ TRỊ MẶC ĐỊNH:
  + category: "academic" (nếu có từ "học", "toán", "lý", "hóa", "bài tập")
  + category: "work" (nếu có từ "làm việc", "họp", "meeting", "báo cáo")
  + category: "personal" (nếu có từ "cá nhân", "riêng tư")
  + category: "health" (nếu có từ "sức khỏe", "tập thể dục", "bác sĩ")
  + category: "social" (nếu có từ "gặp gỡ", "tiệc", "sinh nhật")
  + tags: Tự động tạo từ nội dung (["toán", "học tập"], ["bài tập", "deadline"])
  + description: Tự động tạo từ nội dung
  + estimatedDuration: Tự động tính từ startTime và endTime (phút)
  + location: Để trống nếu user không nói
  + isRecurring: false (mặc định)
  + recurrencePattern: null (mặc định)
  + recurrenceEndDate: null (mặc định)
  
- CÁCH TỰ THIẾT KẾ LỊCH DỰA TRÊN USER DATA:
  + Phân tích thời gian bận/rảnh từ heatmap data
  + Tìm khoảng trống trong lịch hiện tại
  + Gợi ý thời gian phù hợp với lối sống sinh viên (7AM-10PM)
  + Tạo lịch học đều đặn (hàng ngày, hàng tuần)
  + Ưu tiên thời gian rảnh và không xung đột với lịch hiện tại
  + Tự động điền thời gian bắt đầu, kết thúc, và duration
  + Tạo multiple events nếu cần (ví dụ: học tiếng Anh hàng ngày)
  
- VÍ DỤ TỰ THIẾT KẾ LỊCH:
  + User: "tự tạo lịch học tiếng Anh dựa theo data của mình"
  + AI phân tích: User có 5 công việc, tỷ lệ hoàn thành 40%, có thời gian rảnh buổi sáng
  + AI thiết kế: Tạo lịch học tiếng Anh 30 phút mỗi sáng từ 7:00-7:30
  + AI tạo JSON: Multiple events cho 7 ngày trong tuần
  + User: "thiết kế lịch học toán cho mình"
  + AI phân tích: User có 2 công việc quá hạn, cần ưu tiên học toán
  + AI thiết kế: Tạo lịch học toán 2 giờ mỗi tối từ 19:00-21:00
  + AI tạo JSON: Multiple events cho 5 ngày trong tuần
  
- CÁCH TẠO MULTIPLE EVENTS:
  + Nếu user yêu cầu "tự tạo lịch" hoặc "thiết kế lịch", tạo multiple events
  + Tạo 5-7 events cho 1 tuần (tùy theo yêu cầu)
  + Mỗi event có cùng title, description, category, tags
  + Mỗi event có thời gian khác nhau (hàng ngày, hàng tuần)
  + Sử dụng isRecurring: true và recurrencePattern: "daily" hoặc "weekly"
  + Tự động tính recurrenceEndDate (1 tuần hoặc 1 tháng sau)
  
- VÍ DỤ JSON CHO MULTIPLE EVENTS:
  + User: "tự tạo lịch học tiếng Anh dựa theo data của mình"
  + AI tạo JSON array với 7 events:
  \`\`\`json
  {
    "action": "create_multiple_tasks",
    "taskData": [
      {
        "title": "Học tiếng Anh",
        "description": "Luyện nghe và từ vựng tiếng Anh",
        "category": "academic",
        "type": "event",
        "tags": ["tiếng Anh", "học tập"],
        "startTime": "2025-09-16T00:00:00.000Z",
        "endTime": "2025-09-16T00:30:00.000Z",
        "location": "",
        "estimatedDuration": 30,
        "isRecurring": true,
        "recurrencePattern": "daily",
        "recurrenceEndDate": "2025-09-23T00:00:00.000Z"
      }
    ]
  }
  \`\`\`
  
- CÁCH PHÂN TÍCH USER DATA ĐỂ THIẾT KẾ LỊCH:
  + Nếu user có ít công việc (0-3): Tạo lịch học dày đặc hơn
  + Nếu user có nhiều công việc (4+): Tạo lịch học nhẹ nhàng hơn
  + Nếu user có tỷ lệ hoàn thành thấp (<50%): Tạo lịch học ngắn (30-45 phút)
  + Nếu user có tỷ lệ hoàn thành cao (>70%): Tạo lịch học dài (1-2 giờ)
  + Nếu user có công việc quá hạn: Ưu tiên tạo lịch học cho môn đó
  + Nếu user có heatmap data: Tìm thời gian rảnh để tạo lịch học
  + Nếu user không có heatmap data: Tạo lịch học vào giờ phù hợp (7AM-10PM)
  
- CÁCH TẠO MULTIPLE EVENTS:
  + Nếu user yêu cầu "tự tạo lịch" hoặc "thiết kế lịch", tạo multiple events
  + Tạo 5-7 events cho 1 tuần (tùy theo yêu cầu)
  + Mỗi event có cùng title, description, category, tags
  + Mỗi event có thời gian khác nhau (hàng ngày, hàng tuần)
  + Sử dụng isRecurring: true và recurrencePattern: "daily" hoặc "weekly"
  + Tự động tính recurrenceEndDate (1 tuần hoặc 1 tháng sau)
  
- CÁCH TÍNH ESTIMATED DURATION:
  + Nếu user nói "1 giờ" → estimatedDuration = 60
  + Nếu user nói "2 giờ" → estimatedDuration = 120
  + Nếu user nói "1.5 giờ" → estimatedDuration = 90
  + Nếu user nói "90 phút" → estimatedDuration = 90
  + Nếu user nói "120 phút" → estimatedDuration = 120
  + Nếu user không nói duration, mặc định là 90 phút (1.5 giờ)
  + Nếu có startTime và endTime, tính: (endTime - startTime) / 1000 / 60
  
- CÁCH TÍNH END TIME:
  + Nếu user nói "từ 11:00 đến 12:00" → startTime = 11:00, endTime = 12:00
  + Nếu user nói "từ 11:00 trong 1 giờ" → startTime = 11:00, endTime = 12:00
  + Nếu user nói "từ 11:00 trong 90 phút" → startTime = 11:00, endTime = 12:30
  + Nếu user chỉ nói "11:00" → startTime = 11:00, endTime = 12:30 (mặc định 1.5 giờ)
  + Nếu user chỉ nói "trưa mai" → startTime = 12:00, endTime = 13:30 (mặc định 1.5 giờ)

- KHI CÓ ĐỦ THÔNG TIN ĐỂ TẠO TASK/EVENT: Trả về JSON chuẩn theo format sau (bao quanh bằng \`\`\`json và \`\`\`):

  CHO EVENT (lịch học, lịch làm việc, họp):
  \`\`\`json
  {
    "action": "create_task",
    "taskData": {
      "title": "tên event",
      "description": "mô tả event",
      "category": "academic|work|personal|health|social",
      "type": "event",
      "tags": ["tag1", "tag2"],
      "startTime": "2024-12-30T07:00:00.000Z",
      "endTime": "2024-12-30T09:00:00.000Z",
      "location": "địa điểm (có thể để trống)",
      "estimatedDuration": 120,
      "isRecurring": true,
      "recurrencePattern": "weekly",
      "recurrenceEndDate": "2025-06-30T23:59:59.000Z"
    }
  }
  \`\`\`

  CHO TASK (deadline, công việc cần hoàn thành):
  \`\`\`json
  {
    "action": "create_task",
    "taskData": {
      "title": "tên task",
      "description": "mô tả task",
      "category": "academic|work|personal|health|social",
      "type": "task",
      "tags": ["tag1", "tag2"],
      "priority": "low|medium|high|urgent",
      "dueDate": "2024-12-26T23:59:59.000Z",
      "estimatedDuration": 60,
      "status": "pending"
    }
  }
  \`\`\`


- VÍ DỤ CỤ THỂ:

  Event Example: "tạo lịch học toán vào thứ 2 hàng tuần từ 7:00 đến 9:00"
  \`\`\`json
  {
    "action": "create_task",
    "taskData": {
      "title": "học toán",
      "description": "Buổi học toán hàng tuần",
      "category": "academic",
      "type": "event",
      "tags": ["toán", "học tập", "lịch học"],
      "startTime": "2024-12-30T07:00:00.000Z",
      "endTime": "2024-12-30T09:00:00.000Z",
      "location": "",
      "estimatedDuration": 120,
      "isRecurring": true,
      "recurrencePattern": "weekly",
      "recurrenceEndDate": "2025-06-30T23:59:59.000Z"
    }
  }
  \`\`\`

  Task Example: "tạo task làm bài tập deadline sáng mai"
  \`\`\`json
  {
    "action": "create_task",
    "taskData": {
      "title": "làm bài tập",
      "description": "Hoàn thành bài tập được giao",
      "category": "academic",
      "type": "task",
      "tags": ["bài tập", "deadline"],
      "priority": "medium",
      "dueDate": "2024-12-27T08:00:00.000Z",
      "estimatedDuration": 60,
      "status": "pending"
    }
  }
  \`\`\`

  Update Example: "đổi giờ học toán từ 7:00 thành 8:00"
  \`\`\`json
  {
    "action": "update_task",
    "taskId": "task_id_học_toán",
    "taskData": {
      "startTime": "2024-12-30T01:00:00.000Z",
      "endTime": "2024-12-30T03:00:00.000Z"
    }
  }
  \`\`\`

  Delete Example: "xóa lịch học toán"
  \`\`\`json
  {
    "action": "delete_task",
    "taskId": "task_id_học_toán"
  }
  \`\`\`

  Delete All Example: "xóa hết event của tôi hiện tại"
  \`\`\`json
  {
    "action": "delete_task",
    "taskId": "task_id_1"
  }
  \`\`\`
  \`\`\`json
  {
    "action": "delete_task",
    "taskId": "task_id_2"
  }
  \`\`\`
  \`\`\`json
  {
    "action": "delete_task",
    "taskId": "task_id_3"
  }
  \`\`\`

  
  
- CÁCH XỬ LÝ KHI USER YÊU CẦU XÓA/SỬA:
  + Nếu user nói "xóa", "sửa", "hủy", "bỏ" → Từ chối: "Mình chỉ có thể tạo task/event mới. Để xóa hoặc sửa, bạn hãy sử dụng giao diện chính của ứng dụng."
  + Nếu user nói "xóa lịch học toán" → Từ chối: "Mình chỉ có thể tạo task/event mới. Để xóa, bạn hãy sử dụng giao diện chính của ứng dụng."
  + Nếu user nói "sửa lịch học toán" → Từ chối: "Mình chỉ có thể tạo task/event mới. Để sửa, bạn hãy sử dụng giao diện chính của ứng dụng."
  

- CÁCH TÍNH THỜI GIAN:
  + Sử dụng thông tin "Ngày hiện tại (ISO)" và "Ngày mai (ISO)" ở trên để tính toán
  + "hôm nay" = ngày hiện tại (${currentDate})
  + "ngày mai" = ngày mai (${tomorrowDate})
  + "thứ 2" = thứ 2 tuần này hoặc tuần sau (tùy theo ngày hiện tại)
  + QUAN TRỌNG: Tạo thời gian theo VN timezone (UTC+7) NHƯNG lưu dưới dạng UTC
  + "12 trưa" = 12:00 VN time = 05:00 UTC (trừ 7 giờ)
  + "7:00 sáng" = 07:00 VN time = 00:00 UTC (trừ 7 giờ)
  + "8:00 tối" = 20:00 VN time = 13:00 UTC (trừ 7 giờ)
  + estimatedDuration = (endTime - startTime) tính bằng phút
  + Ví dụ: "12 trưa hôm nay" = ${currentDate}T05:00:00.000Z (12:00 VN = 05:00 UTC)
  + Ví dụ: "12 trưa mai" = ${tomorrowDate}T05:00:00.000Z (12:00 VN = 05:00 UTC)
  + Ví dụ: "11:00 mai" = ${tomorrowDate}T04:00:00.000Z (11:00 VN = 04:00 UTC)
  + Ví dụ: "13:00 mai" = ${tomorrowDate}T06:00:00.000Z (13:00 VN = 06:00 UTC)
  + Ví dụ: "trưa mai lúc 11:00" = ${tomorrowDate}T04:00:00.000Z (11:00 VN = 04:00 UTC)
  + Ví dụ: "trưa mai lúc 12:00" = ${tomorrowDate}T05:00:00.000Z (12:00 VN = 05:00 UTC)
  + LƯU Ý: KHÔNG sử dụng +07:00, chỉ sử dụng Z (UTC) trong JSON
  + SAI: "startTime": "2025-09-15T12:00:00.000+07:00"
  + ĐÚNG: "startTime": "2025-09-15T05:00:00.000Z"
  
- QUAN TRỌNG: Khi user nói "trưa mai lúc 11:00", AI phải hiểu:
  + "trưa mai" = ngày mai (${tomorrowDate})
  + "lúc 11:00" = 11:00 VN time = 04:00 UTC
  + Kết quả: "startTime": "${tomorrowDate}T04:00:00.000Z"
  + KHÔNG được tạo "startTime": "${tomorrowDate}T05:00:00.000Z" (12:00 VN)
  
- CÁCH PHÂN TÍCH THỜI GIAN TỪ USER REQUEST:
  + Bước 1: Tìm từ khóa thời gian ("trưa mai", "sáng mai", "tối mai", "hôm nay", "ngày mai")
  + Bước 2: Tìm giờ cụ thể ("11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00", "09:00", "10:00")
  + Bước 3: Nếu có giờ cụ thể, sử dụng giờ đó thay vì giờ mặc định
  + Bước 4: Chuyển đổi giờ VN sang UTC (trừ 7 giờ)
  + Bước 5: Tạo JSON với timezone UTC (Z)
  
- VÍ DỤ CỤ THỂ:
  + User: "tạo lịch toán 12 vào trưa mai lúc 11:00"
  + Phân tích: "trưa mai" = ngày mai, "11:00" = 11:00 VN
  + Kết quả: "startTime": "${tomorrowDate}T04:00:00.000Z"
  + User: "tạo lịch toán 12 vào trưa mai lúc 12:00"
  + Phân tích: "trưa mai" = ngày mai, "12:00" = 12:00 VN
  + Kết quả: "startTime": "${tomorrowDate}T05:00:00.000Z"
  + User: "tạo lịch toán 12 vào trưa mai lúc 13:00"
  + Phân tích: "trưa mai" = ngày mai, "13:00" = 13:00 VN
  + Kết quả: "startTime": "${tomorrowDate}T06:00:00.000Z"
  
- LƯU Ý QUAN TRỌNG:
  + Khi user nói "trưa mai lúc 11:00", KHÔNG được hiểu là "12:00 VN"
  + Phải hiểu là "11:00 VN" và chuyển đổi thành "04:00 UTC"
  + Tương tự với các giờ khác: "12:00 VN" = "05:00 UTC", "13:00 VN" = "06:00 UTC"
  + Luôn ưu tiên giờ cụ thể mà user đã nói
  
- CÁCH TÍNH END TIME:
  + Nếu user không nói thời gian kết thúc, mặc định là 1.5 giờ sau start time
  + Ví dụ: "startTime": "${tomorrowDate}T04:00:00.000Z" (11:00 VN)
  + Thì: "endTime": "${tomorrowDate}T05:30:00.000Z" (12:30 VN)
  + estimatedDuration = 90 phút

- CÁCH TÍNH DEADLINE (cho Task):
  + "sáng mai" = ngày mai 8:00 AM
  + "chiều mai" = ngày mai 2:00 PM  
  + "tối mai" = ngày mai 8:00 PM
  + "ngày mai" = ngày mai 11:59 PM

- CÁCH PHÂN TÍCH THỜI GIAN TỪ USER REQUEST:
  + Khi user nói "11:00" = 11:00 VN time = 04:00 UTC
  + Khi user nói "12:00" = 12:00 VN time = 05:00 UTC  
  + Khi user nói "13:00" = 13:00 VN time = 06:00 UTC
  + Khi user nói "14:00" = 14:00 VN time = 07:00 UTC
  + Khi user nói "15:00" = 15:00 VN time = 08:00 UTC
  + Khi user nói "16:00" = 16:00 VN time = 09:00 UTC
  + Khi user nói "17:00" = 17:00 VN time = 10:00 UTC
  + Khi user nói "18:00" = 18:00 VN time = 11:00 UTC
  + Khi user nói "19:00" = 19:00 VN time = 12:00 UTC
  + Khi user nói "20:00" = 20:00 VN time = 13:00 UTC
  + Khi user nói "21:00" = 21:00 VN time = 14:00 UTC

- CÁCH HIỂU THỜI GIAN CỤ THỂ:
  + "11:00" = 11:00 VN time = 04:00 UTC (trừ 7 giờ)
  + "12:00" = 12:00 VN time = 05:00 UTC (trừ 7 giờ)
  + "13:00" = 13:00 VN time = 06:00 UTC (trừ 7 giờ)
  + "14:00" = 14:00 VN time = 07:00 UTC (trừ 7 giờ)
  + "15:00" = 15:00 VN time = 08:00 UTC (trừ 7 giờ)
  + "16:00" = 16:00 VN time = 09:00 UTC (trừ 7 giờ)
  + "17:00" = 17:00 VN time = 10:00 UTC (trừ 7 giờ)
  + "18:00" = 18:00 VN time = 11:00 UTC (trừ 7 giờ)
  + "19:00" = 19:00 VN time = 12:00 UTC (trừ 7 giờ)
  + "tuần sau" = 7 ngày từ hôm nay 11:59 PM
  + "tháng sau" = 30 ngày từ hôm nay 11:59 PM
  + "cuối tuần" = Chủ nhật tuần này 11:59 PM
  + "cuối tháng" = Ngày cuối tháng hiện tại 11:59 PM
  + "hôm nay" = hôm nay 11:59 PM
  + "tuần này" = Chủ nhật tuần này 11:59 PM
  + "tháng này" = Ngày cuối tháng hiện tại 11:59 PM

- LOGIC RECURRING CHO EVENT:
  + Nếu user nói "hàng tuần", "hàng ngày", "hàng tháng" → isRecurring=true
  + Nếu user nói "một lần", "chỉ hôm nay" → isRecurring=false
  + recurrencePattern: "daily" (hàng ngày), "weekly" (hàng tuần), "monthly" (hàng tháng)
  + recurrenceEndDate: Mặc định là cuối học kỳ (6 tháng) nếu không có thông tin cụ thể

- LOGIC TÍNH TOÁN THỜI GIAN:
  + Lấy thời gian hiện tại làm mốc
  + Tính toán chính xác ngày giờ dựa trên từ khóa
  + Chuyển đổi sang ISO string với timezone VN
  + Ưu tiên thời gian cụ thể nếu user cung cấp (VD: "8:00 sáng mai")
  + Mặc định thời gian hợp lý nếu không có thông tin cụ thể

- CÁC FIELD BẮT BUỘC:
  + title: Tên task/event (bắt buộc)
  + category: academic|work|personal|health|social (bắt buộc)
  + type: "task" hoặc "event" (bắt buộc)
  + description: Mô tả chi tiết (có thể để trống)
  + tags: Array các tag liên quan
  + estimatedDuration: Thời gian ước tính (phút)

- FIELD CHO EVENT:
  + startTime: Thời gian bắt đầu (ISO string)
  + endTime: Thời gian kết thúc (ISO string)
  + location: Địa điểm (có thể để trống)
  + isRecurring: true/false (có lặp lại hay không)
  + recurrencePattern: "daily|weekly|monthly" (chỉ khi isRecurring=true)
  + recurrenceEndDate: Ngày kết thúc lặp lại (ISO string, chỉ khi isRecurring=true)

- FIELD CHO TASK:
  + priority: low|medium|high|urgent
  + dueDate: Deadline (ISO string)
  + status: "pending" (mặc định)
- Nếu user hỏi về lịch trình, hãy phân tích thời gian bận/rảnh và đưa ra gợi ý
- Nếu user hỏi về ưu tiên, hãy đánh giá tasks hiện tại và đưa ra lời khuyên
- Nếu user hỏi về hiệu suất, hãy phân tích completion rate và productivity score
- Trả lời ngắn gọn, súc tích, tập trung vào câu hỏi cụ thể của user
- KHÔNG đào sâu hoặc hỏi quá nhiều câu hỏi phụ`;
}

// Fallback recommendations function
function generateFallbackRecommendations(tasks, taskStats, timeAccuracy, language = 'vi') {
  const isVietnamese = language === 'vi';
  const recommendations = [];
  
  const totalTasks = tasks.length;
  const completedTasks = taskStats.completedTasks || 0;
  const overdueTasks = taskStats.overdueTasks || 0;
  const productivityScore = taskStats.productivityScore || 0;
  const accuracy = timeAccuracy?.accuracy || 0;
  
  // Calculate weekly event time
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const weeklyEventTime = tasks
    .filter(task => task.type === 'event')
    .filter(task => {
      if (!task.startTime || !task.endTime) return false;
      const startTime = new Date(task.startTime);
      return startTime >= startOfWeek && startTime <= endOfWeek;
    })
    .reduce((total, task) => {
      if (!task.startTime || !task.endTime) return total;
      const startTime = new Date(task.startTime);
      const endTime = new Date(task.endTime);
      return total + (endTime.getTime() - startTime.getTime()) / (1000 * 60);
    }, 0);

  const weeklyHours = weeklyEventTime / 60;
  
  // Category analysis
  const categories = ['academic', 'work', 'personal', 'health', 'social'];
  const categoryStats = categories.map(category => {
    const categoryTasks = tasks.filter(task => task.category === category);
    return `${category},${categoryTasks.length}`;
  });
  
  const mostActiveCategory = categoryStats.reduce(
    (max, stat) => {
      const [category, total] = stat.split(',');
      const totalNum = parseInt(total);
      return totalNum > max.total ? { total: totalNum, category } : max;
    },
    { total: 0, category: "" }
  );
  
  if (isVietnamese) {
    // 1. Weekly study/work time analysis
    if (weeklyHours > 50) {
      recommendations.push(`Thời gian: Bạn đang dành quá nhiều thời gian cho việc học và làm việc trong tuần. Hãy cân bằng với thời gian nghỉ ngơi để tránh kiệt sức.`);
    } else if (weeklyHours < 20) {
      recommendations.push(`Thời gian: Thời gian học tập và làm việc trong tuần khá ít. Có thể tăng cường thêm để tối ưu hóa năng suất.`);
    } else {
      recommendations.push(`Thời gian: Thời gian học tập và làm việc trong tuần của bạn khá hợp lý. Hãy tiếp tục duy trì nhịp độ này.`);
    }
    
    // 2. Deadline analysis
    if (overdueTasks > 0) {
      recommendations.push(`Deadline: Bạn có ${overdueTasks} nhiệm vụ đã quá hạn. Hãy ưu tiên hoàn thành những nhiệm vụ này trước khi bắt đầu nhiệm vụ mới.`);
    }
    
    // 3. Category preference analysis
    if (mostActiveCategory.total > 0) {
      const categoryName = mostActiveCategory.category === 'academic' ? 'học tập' : 
                          mostActiveCategory.category === 'work' ? 'công việc' :
                          mostActiveCategory.category === 'personal' ? 'cá nhân' :
                          mostActiveCategory.category === 'health' ? 'sức khỏe' :
                          mostActiveCategory.category === 'social' ? 'xã hội' : mostActiveCategory.category;
      const percentage = Math.round((mostActiveCategory.total / totalTasks) * 100);
      
      if (percentage > 50) {
        recommendations.push(`Sở thích: Bạn có xu hướng tập trung nhiều vào ${categoryName} (${percentage}% tổng số nhiệm vụ). Đây có thể là sở thích hoặc ưu tiên của bạn.`);
      } else if (percentage < 10) {
        recommendations.push(`Sở thích: Bạn ít quan tâm đến ${categoryName} (chỉ ${percentage}% tổng số nhiệm vụ). Có thể cần cân bằng hơn.`);
      }
    }
    
    // 4. Time management suggestions
    if (weeklyHours >= 20 && weeklyHours <= 50 && overdueTasks === 0) {
      recommendations.push(`Quản lý thời gian: Cách sắp xếp thời gian và học tập của bạn khá hợp lý. Hãy tiếp tục duy trì thói quen tốt này.`);
    } else {
      recommendations.push(`Kỹ thuật: Sử dụng kỹ thuật Pomodoro (25 phút tập trung + 5 phút nghỉ) để tăng hiệu quả học tập và làm việc.`);
    }
    
  } else {
    // English version
    if (weeklyHours > 50) {
      recommendations.push(`Time: You're spending too much time on study and work this week. Balance with rest time to avoid burnout.`);
    } else if (weeklyHours < 20) {
      recommendations.push(`Time: Your study and work time this week is quite low. Consider increasing it to optimize productivity.`);
    } else {
      recommendations.push(`Time: Your weekly study and work time is well balanced. Keep maintaining this pace.`);
    }
    
    if (overdueTasks > 0) {
      recommendations.push(`Deadline: You have ${overdueTasks} overdue tasks. Prioritize completing these before starting new ones.`);
    }
    
    if (mostActiveCategory.total > 0) {
      const percentage = Math.round((mostActiveCategory.total / totalTasks) * 100);
      if (percentage > 50) {
        recommendations.push(`Preferences: You tend to focus heavily on ${mostActiveCategory.category} (${percentage}% of total tasks). This might be your preference or priority.`);
      } else if (percentage < 10) {
        recommendations.push(`Preferences: You pay less attention to ${mostActiveCategory.category} (only ${percentage}% of total tasks). Consider balancing more.`);
      }
    }
    
    if (weeklyHours >= 20 && weeklyHours <= 50 && overdueTasks === 0) {
      recommendations.push(`Time Management: Your time management and study approach is quite reasonable. Keep maintaining these good habits.`);
    } else {
      recommendations.push(`Technique: Use Pomodoro technique (25 minutes focus + 5 minutes break) to increase study and work efficiency.`);
    }
    
  }
  
  return recommendations;
}

// Fallback response function
function generateFallbackResponse(userMessage, tasks) {
  const context = createTasksContext(tasks);
  const lowerMessage = userMessage.toLowerCase();

  // Tạo task
  if (lowerMessage.includes('tạo') || lowerMessage.includes('thêm') || lowerMessage.includes('add') || lowerMessage.includes('create') || lowerMessage.includes('lịch')) {
    return `Để tạo task/event, bạn có thể nói như:\n\n• "Tạo lịch Toán 12 vào thứ 2 từ 7:00 đến 9:50 hàng tuần"\n• "Tạo task học bài ngày mai ưu tiên cao"\n• "Thêm event họp nhóm thứ 3 từ 14:00 đến 15:30"\n\nTôi sẽ tự động điền form và hiển thị preview để bạn xác nhận!`;
  }

  // Ưu tiên
  if (lowerMessage.includes('ưu tiên') || lowerMessage.includes('priority') || lowerMessage.includes('quan trọng')) {
    let response = `Hiện tại bạn có ${context.totalTasks} tasks tổng cộng.\n\n`;
    
    if (context.overdueTasks > 0) {
      response += `Có ${context.overdueTasks} tasks quá hạn cần xử lý ngay!\n`;
    }
    
    if (context.urgentTasks > 0) {
      response += `${context.urgentTasks} tasks urgent cần ưu tiên hôm nay.\n`;
    }
    
    if (context.highPriorityTasks > 0) {
      response += `${context.highPriorityTasks} tasks high priority cần lên kế hoạch tuần này.\n`;
    }
    
    response += `\nGợi ý: Chia nhỏ tasks lớn thành các phần 25-30 phút để dễ quản lý hơn!`;
    
    return response;
  }

  // Lịch trình và deadlines
  if (lowerMessage.includes('lịch') || lowerMessage.includes('schedule') || lowerMessage.includes('deadline') || lowerMessage.includes('hạn')) {
    if (context.upcomingDeadlines.length > 0) {
      const upcomingTasks = context.upcomingDeadlines.slice(0, 3);
      return `Deadlines sắp tới:\n${upcomingTasks.map((task, index) => 
        `${index + 1}. ${task.title} - ${new Date(task.dueDate).toLocaleDateString('vi-VN')} (${task.priority.toUpperCase()})`
      ).join('\n')}\n\nLời khuyên: Ưu tiên tasks có deadline trong 24-48h tới, nhớ dành thời gian buffer!`;
    } else {
      return `Hiện tại bạn chưa có deadline nào sắp tới. Đây là cơ hội tốt để lên kế hoạch cho các tasks dài hạn!`;
    }
  }

  // Hiệu suất
  if (lowerMessage.includes('hiệu suất') || lowerMessage.includes('productivity') || lowerMessage.includes('thống kê') || lowerMessage.includes('phân tích')) {
    const completionRate = context.totalTasks > 0 ? Math.round((context.completedTasks / context.totalTasks) * 100) : 0;
    
    return `Hiệu suất hiện tại:\n• Hoàn thành: ${completionRate}% (${context.completedTasks}/${context.totalTasks} tasks)\n• Đang thực hiện: ${context.inProgressTasks} tasks\n• Quá hạn: ${context.overdueTasks} tasks\n\nTips cải thiện:\n• Sử dụng Pomodoro 25 phút + 5 phút nghỉ\n• Tập trung 1 task tại một thời điểm\n• Đặt deadline thực tế hơn`;
  }

  // Thời gian
  if (lowerMessage.includes('thời gian') || lowerMessage.includes('time') || lowerMessage.includes('quản lý')) {
    return `Quản lý thời gian hiệu quả:\n\nNguyên tắc cơ bản:\n• Quy tắc 80/20: 20% công việc tạo ra 80% kết quả\n• Time blocking: Chia ngày thành các khung thời gian cụ thể\n• Buffer time: Dành 25% thời gian cho việc không lường trước\n\nTình trạng hiện tại: ${context.totalTasks} tasks tổng cộng, ${context.overdueTasks} quá hạn\n\nGợi ý: Tập trung hoàn thành ${context.overdueTasks > 0 ? context.overdueTasks + " tasks quá hạn trước" : "các tasks có deadline gần nhất"}!`;
  }

  // Giúp đỡ
  if (lowerMessage.includes('giúp') || lowerMessage.includes('help') || lowerMessage.includes('hướng dẫn')) {
    return `Tôi có thể giúp bạn:\n\n• Tạo task: "Tạo task học bài với mô tả ôn tập toán, ngày hạn ngày mai, ưu tiên cao"\n• Xem ưu tiên: "Ưu tiên công việc", "Tasks quan trọng"\n• Lịch trình: "Deadline sắp tới", "Lịch tuần này"\n• Hiệu suất: "Phân tích hiệu suất", "Thống kê tasks"\n• Quản lý thời gian: "Tips quản lý thời gian"\n\nChỉ cần hỏi tự nhiên, tôi sẽ hiểu và giúp bạn!`;
  }

  // Chào hỏi
  if (lowerMessage.includes('xin chào') || lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('chào')) {
    return `Xin chào! Tôi là AI Assistant của N-Timer.\n\nTình trạng hiện tại:\n• ${context.totalTasks} tasks tổng cộng\n• ${context.pendingTasks} đang chờ\n• ${context.inProgressTasks} đang thực hiện\n• ${context.completedTasks} đã hoàn thành\n• ${context.overdueTasks} quá hạn\n\nTôi có thể giúp bạn tạo task, phân tích ưu tiên, quản lý thời gian và nhiều hơn nữa!\n\nBạn muốn làm gì hôm nay?`;
  }

  // Mặc định
  return `Tôi hiểu bạn đang hỏi về: "${userMessage}"\n\nTình trạng hiện tại: ${context.totalTasks} tasks tổng cộng\n\nTôi có thể giúp:\n• Tạo task mới\n• Phân tích ưu tiên công việc\n• Xem lịch trình và deadlines\n• Tips quản lý thời gian\n• Phân tích hiệu suất\n\nHãy hỏi cụ thể hơn để tôi có thể hỗ trợ tốt nhất!`;
}

// Start server
app.listen(PORT, () => {
});
