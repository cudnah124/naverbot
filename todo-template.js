// TODO List Template cho AI Chatbot
// Template này cung cấp format chuẩn cho AI khi trả lời về ưu tiên

const TODO_TEMPLATE = {
  // Format cơ bản cho mỗi todo item
  itemFormat: "☐ [Task/Activity] - [Time/Deadline] - [Priority]",
  
  // Thứ tự ưu tiên
  priorityOrder: [
    "OVERDUE",    // Quá hạn - cần làm ngay
    "URGENT",     // Khẩn cấp - hôm nay
    "HIGH",       // Cao - tuần này
    "MEDIUM",     // Trung bình - khi có thời gian
    "LOW",        // Thấp - có thể trì hoãn
    "IN-PROGRESS" // Đang thực hiện - tiếp tục
  ],
  
  // Time indicators
  timeIndicators: {
    OVERDUE: "NGAY LẬP TỨC",
    URGENT: "Hôm nay",
    HIGH: "Tuần này", 
    MEDIUM: "Khi có thời gian",
    LOW: "Sau này",
    IN_PROGRESS: "Liên tục"
  },
  
  // Emoji cho từng loại priority
  priorityEmojis: {
    OVERDUE: "🚨",
    URGENT: "⚡", 
    HIGH: "🔥",
    MEDIUM: "📋",
    LOW: "📝",
    IN_PROGRESS: "🔄"
  },
  
  // Template cho các loại câu hỏi khác nhau
  templates: {
    priority: {
      title: "📋 **TODO LIST ƯU TIÊN**",
      format: "☐ [Task] - [Time] - [Priority]",
      advice: "💡 **Lời khuyên:** Bắt đầu với tasks quá hạn và urgent trước!"
    },
    
    schedule: {
      title: "📅 **LỊCH TRÌNH HÔM NAY**", 
      format: "☐ [Task] - [Time] - [Duration]",
      advice: "⏰ **Tip:** Dành 25% thời gian cho buffer time!"
    },
    
    productivity: {
      title: "🚀 **PLAN TĂNG PRODUCTIVITY**",
      format: "☐ [Action] - [When] - [Impact]",
      advice: "💪 **Focus:** Pomodoro 25 phút + 5 phút break!"
    }
  },
  
  // Helper function để tạo todo item
  createTodoItem: (task, time, priority) => {
    const emoji = TODO_TEMPLATE.priorityEmojis[priority] || "📝";
    return `${emoji} ☐ ${task} - ${time} - ${priority}`;
  },
  
  // Helper function để tạo todo list
  createTodoList: (title, items, advice) => {
    return `${title}\n\n${items.join('\n')}\n\n${advice}`;
  },
  
  // Template cho sinh viên
  studentTemplates: {
    exam: {
      title: "📚 **KẾ HOẠCH ÔN THI**",
      items: [
        "☐ Ôn tập lý thuyết - 2 tiếng - HIGH",
        "☐ Làm bài tập thực hành - 1 tiếng - HIGH", 
        "☐ Review lại bài cũ - 30 phút - MEDIUM",
        "☐ Chuẩn bị tài liệu - 15 phút - LOW"
      ],
      advice: "🎯 **Tip:** Active recall > passive reading!"
    },
    
    assignment: {
      title: "📝 **KẾ HOẠCH LÀM BÀI TẬP**",
      items: [
        "☐ Đọc đề bài kỹ - 10 phút - URGENT",
        "☐ Lên outline - 20 phút - HIGH",
        "☐ Viết nội dung chính - 2 tiếng - HIGH",
        "☐ Review và sửa lỗi - 30 phút - MEDIUM"
      ],
      advice: "✍️ **Tip:** Chia nhỏ task lớn thành subtasks!"
    },
    
    groupwork: {
      title: "👥 **KẾ HOẠCH LÀM VIỆC NHÓM**",
      items: [
        "☐ Họp nhóm phân công - 30 phút - URGENT",
        "☐ Hoàn thành phần cá nhân - 2 tiếng - HIGH",
        "☐ Tổng hợp và review - 1 tiếng - HIGH",
        "☐ Chuẩn bị presentation - 45 phút - MEDIUM"
      ],
      advice: "🤝 **Tip:** Communication is key - update thường xuyên!"
    }
  }
};

module.exports = TODO_TEMPLATE;
