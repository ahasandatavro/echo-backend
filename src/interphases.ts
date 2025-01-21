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
      type?: "number" | "date" | "datetime" | "time" | "pattern" | "image" | "video" | "audio" | "document" | ""; // Validation types
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
  
  export interface Row {
    id: string; // Unique identifier for the row
    title: string; // The title of the row (required)
    description?: string; // An optional description for the row
  }
  
  export interface Section {
    sectionTitle: string; // The title of the section (required)
    rows: string[]; // Array of rows belonging to this section
  }
  
  export interface ListMessage {
    header?: string; // Optional header text
    text: string; // Body text (required)
    footer?: string; // Optional footer text
    buttonText: string; // Button text (required)
    sections: Section[]; // Array of sections
    saveAnswerVariable?: string
  }
  