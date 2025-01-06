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
  