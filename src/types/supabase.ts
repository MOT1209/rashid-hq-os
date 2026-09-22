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
          actor_type: string | null;
          agent_name: string | null;
          created_at: string;
          decision: string | null;
          decision_reason: string | null;
          id: string;
          payload: Json | null;
          project_id: string | null;
          result: Json | null;
          status: string;
          tool_name: string | null;
        };
        Insert: {
          actor_type?: string | null;
          agent_name?: string | null;
          created_at?: string;
          decision?: string | null;
          decision_reason?: string | null;
          id?: string;
          payload?: Json | null;
          project_id?: string | null;
          result?: Json | null;
          status?: string;
          tool_name?: string | null;
        };
        Update: {
          actor_type?: string | null;
          agent_name?: string | null;
          created_at?: string;
          decision?: string | null;
          decision_reason?: string | null;
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
      agent_runs: {
        Row: {
          id: string;
          agent_name: string;
          kind: string;
          tokens_in: number | null;
          tokens_out: number | null;
          duration_ms: number;
          step_count: number;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          agent_name: string;
          kind: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          duration_ms: number;
          step_count: number;
          status: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          agent_name?: string;
          kind?: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          duration_ms?: number;
          step_count?: number;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      tool_approvals: {
        Row: {
          id: string;
          log_id: string;
          tool_name: string;
          args: Json;
          ctx: Json;
          status: string;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          log_id: string;
          tool_name: string;
          args: Json;
          ctx: Json;
          status?: string;
          decided_by?: string | null;
          decided_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          log_id?: string;
          tool_name?: string;
          args?: Json;
          ctx?: Json;
          status?: string;
          decided_by?: string | null;
          decided_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tool_approvals_log_id_fkey";
            columns: ["log_id"];
            isOneToOne: false;
            referencedRelation: "agent_logs";
            referencedColumns: ["id"];
          },
        ];
      };
      members: {
        Row: {
          created_at: string;
          email: string;
          invited_by: string | null;
          role: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          invited_by?: string | null;
          role?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          invited_by?: string | null;
          role?: string;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          agent_label_ar: string;
          agent_label_en: string;
          agent_name: string;
          budget_alerted_at: string | null;
          created_at: string;
          icon: string;
          is_fallback: boolean;
          key: string;
          model: string | null;
          monthly_token_budget: number | null;
          name_ar: string;
          name_en: string;
          sort_order: number;
          standing_task: string | null;
          standing_task_enabled: boolean;
          system_prompt: string;
        };
        Insert: {
          agent_label_ar: string;
          agent_label_en: string;
          agent_name: string;
          budget_alerted_at?: string | null;
          created_at?: string;
          icon?: string;
          is_fallback?: boolean;
          key: string;
          model?: string | null;
          monthly_token_budget?: number | null;
          name_ar: string;
          name_en: string;
          sort_order?: number;
          standing_task?: string | null;
          standing_task_enabled?: boolean;
          system_prompt?: string;
        };
        Update: {
          agent_label_ar?: string;
          agent_label_en?: string;
          agent_name?: string;
          budget_alerted_at?: string | null;
          created_at?: string;
          icon?: string;
          is_fallback?: boolean;
          key?: string;
          model?: string | null;
          monthly_token_budget?: number | null;
          name_ar?: string;
          name_en?: string;
          sort_order?: number;
          standing_task?: string | null;
          standing_task_enabled?: boolean;
          system_prompt?: string;
        };
        Relationships: [];
      };
      project_categories: {
        Row: {
          created_at: string;
          department_key: string | null;
          label_ar: string;
          label_en: string;
          sort_order: number;
          value: string;
        };
        Insert: {
          created_at?: string;
          department_key?: string | null;
          label_ar: string;
          label_en: string;
          sort_order?: number;
          value: string;
        };
        Update: {
          created_at?: string;
          department_key?: string | null;
          label_ar?: string;
          label_en?: string;
          sort_order?: number;
          value?: string;
        };
        Relationships: [];
      };
      agent_skills: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          prompt: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          prompt: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          prompt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_skills_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user";
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
      integration_connections: {
        Row: {
          id: string;
          owner_id: string;
          provider: string;
          status: string;
          secret_ciphertext: string | null;
          metadata: Json;
          expires_at: string | null;
          last_connected_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          provider: string;
          status?: string;
          secret_ciphertext?: string | null;
          metadata?: Json;
          expires_at?: string | null;
          last_connected_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          provider?: string;
          status?: string;
          secret_ciphertext?: string | null;
          metadata?: Json;
          expires_at?: string | null;
          last_connected_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      integration_oauth_states: {
        Row: {
          state: string;
          owner_id: string;
          provider: string;
          code_verifier: string | null;
          redirect_to: string | null;
          scopes: string[];
          created_at: string;
          expires_at: string;
        };
        Insert: {
          state: string;
          owner_id: string;
          provider: string;
          code_verifier?: string | null;
          redirect_to?: string | null;
          scopes?: string[];
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          state?: string;
          owner_id?: string;
          provider?: string;
          code_verifier?: string | null;
          redirect_to?: string | null;
          scopes?: string[];
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          id: string;
          provider: string;
          event_id: string | null;
          event_type: string | null;
          content_hash: string | null;
          status: string;
          payload: Json | null;
          received_at: string;
        };
        Insert: {
          id?: string;
          provider: string;
          event_id?: string | null;
          event_type?: string | null;
          content_hash?: string | null;
          status?: string;
          payload?: Json | null;
          received_at?: string;
        };
        Update: {
          id?: string;
          provider?: string;
          event_id?: string | null;
          event_type?: string | null;
          content_hash?: string | null;
          status?: string;
          payload?: Json | null;
          received_at?: string;
        };
        Relationships: [];
      };
      policies: {
        Row: {
          actor_type: string | null;
          created_at: string;
          decision: string;
          description: string;
          enabled: boolean;
          exclude_tool: string | null;
          id: string;
          priority: number;
          required_scope: string | null;
          tool_names: string[];
        };
        Insert: {
          actor_type?: string | null;
          created_at?: string;
          decision: string;
          description?: string;
          enabled?: boolean;
          exclude_tool?: string | null;
          id: string;
          priority?: number;
          required_scope?: string | null;
          tool_names?: string[];
        };
        Update: {
          actor_type?: string | null;
          created_at?: string;
          decision?: string;
          description?: string;
          enabled?: boolean;
          exclude_tool?: string | null;
          id?: string;
          priority?: number;
          required_scope?: string | null;
          tool_names?: string[];
        };
        Relationships: [];
      };
      budget_events: {
        Row: {
          agent_name: string;
          budget: number;
          created_at: string;
          id: string;
          kind: string;
          tokens_used: number;
        };
        Insert: {
          agent_name: string;
          budget: number;
          created_at?: string;
          id?: string;
          kind: string;
          tokens_used: number;
        };
        Update: {
          agent_name?: string;
          budget?: number;
          created_at?: string;
          id?: string;
          kind?: string;
          tokens_used?: number;
        };
        Relationships: [];
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
      /** Deletes agent_logs older than the interval; see migration 0006. */
      prune_agent_logs: {
        Args: { older_than?: string };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
