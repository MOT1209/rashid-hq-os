// Generated from the Supabase project (ref: gxjcpfhnzhzanzmuwzxr).
// Regenerate after schema changes; app-facing aliases live in ./database.ts.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      agent_logs: {
        Row: {
          agent_name: string | null;
          created_at: string;
          id: string;
          payload: Json | null;
          project_id: string | null;
          result: Json | null;
          status: string;
          tool_name: string | null;
        };
        Insert: {
          agent_name?: string | null;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          project_id?: string | null;
          result?: Json | null;
          status?: string;
          tool_name?: string | null;
        };
        Update: {
          agent_name?: string | null;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          project_id?: string | null;
          result?: Json | null;
          status?: string;
          tool_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_tokens: {
        Row: {
          agent_name: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          last_used_at: string | null;
          project_id: string | null;
          revoked_at: string | null;
          scopes: string[];
          token_hash: string;
          token_prefix: string;
        };
        Insert: {
          agent_name: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          project_id?: string | null;
          revoked_at?: string | null;
          scopes?: string[];
          token_hash: string;
          token_prefix: string;
        };
        Update: {
          agent_name?: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          project_id?: string | null;
          revoked_at?: string | null;
          scopes?: string[];
          token_hash?: string;
          token_prefix?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_tokens_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_tools: {
        Row: {
          created_at: string;
          description: string | null;
          endpoint: string | null;
          id: string;
          input_schema: Json | null;
          project_id: string;
          tool_name: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          endpoint?: string | null;
          id?: string;
          input_schema?: Json | null;
          project_id: string;
          tool_name: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          endpoint?: string | null;
          id?: string;
          input_schema?: Json | null;
          project_id?: string;
          tool_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_tools_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          category: string | null;
          created_at: string;
          id: string;
          mcp_endpoint: string | null;
          name: string;
          owner_id: string | null;
          repository_url: string | null;
          status: string;
          url: string | null;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          id?: string;
          mcp_endpoint?: string | null;
          name: string;
          owner_id?: string | null;
          repository_url?: string | null;
          status?: string;
          url?: string | null;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          id?: string;
          mcp_endpoint?: string | null;
          name?: string;
          owner_id?: string | null;
          repository_url?: string | null;
          status?: string;
          url?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
