export interface NodeData {
    chat_id: string;
    node_id: string;
    data: object;
}

export interface User {
    id: string; // or number, depending on your system
    role: string;
    email?: string; // Optional, add other properties as needed
  }
  
    export interface IQuestion extends BaseNodeData {
    questionText: string; 
    answerVariants?: string[]; 
    saveAnswerVariable?: string; 
    acceptMediaResponse?: boolean; 
    validation?: {
      type?: "number" | "date" | "datetime" | "time" | "pattern" | "image" | "video" | "audio" | "document"; // Validation types
      errorMessage?: string;
      minValue?: number;
      maxValue?: number; 
      regexPattern?: string; 
    };
    validationFailureExitCount?: number; 
  }
  export interface BaseNodeData {
    label?: string;
    icon?: any;
    description?: string;
  }
  