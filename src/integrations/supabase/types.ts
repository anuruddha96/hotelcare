export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          image_url: string | null
          ticket_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          ticket_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      department_access_config: {
        Row: {
          access_scope: string
          can_manage_all: boolean
          created_at: string
          department: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          access_scope: string
          can_manage_all?: boolean
          created_at?: string
          department: string
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          access_scope?: string
          can_manage_all?: boolean
          created_at?: string
          department?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      hotels: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      housekeeping_notes: {
        Row: {
          assignment_id: string | null
          content: string
          created_at: string
          created_by: string
          id: string
          is_resolved: boolean
          note_type: string
          resolved_at: string | null
          resolved_by: string | null
          room_id: string
          updated_at: string
        }
        Insert: {
          assignment_id?: string | null
          content: string
          created_at?: string
          created_by: string
          id?: string
          is_resolved?: boolean
          note_type?: string
          resolved_at?: string | null
          resolved_by?: string | null
          room_id: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string | null
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          is_resolved?: boolean
          note_type?: string
          resolved_at?: string | null
          resolved_by?: string | null
          room_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      housekeeping_performance: {
        Row: {
          actual_duration_minutes: number
          assignment_date: string
          assignment_id: string
          assignment_type: Database["public"]["Enums"]["assignment_type"]
          completed_at: string
          created_at: string
          efficiency_score: number
          estimated_duration_minutes: number | null
          housekeeper_id: string
          id: string
          room_id: string
          started_at: string
          updated_at: string
        }
        Insert: {
          actual_duration_minutes: number
          assignment_date: string
          assignment_id: string
          assignment_type: Database["public"]["Enums"]["assignment_type"]
          completed_at: string
          created_at?: string
          efficiency_score?: number
          estimated_duration_minutes?: number | null
          housekeeper_id: string
          id?: string
          room_id: string
          started_at: string
          updated_at?: string
        }
        Update: {
          actual_duration_minutes?: number
          assignment_date?: string
          assignment_id?: string
          assignment_type?: Database["public"]["Enums"]["assignment_type"]
          completed_at?: string
          created_at?: string
          efficiency_score?: number
          estimated_duration_minutes?: number | null
          housekeeper_id?: string
          id?: string
          room_id?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "housekeeping_performance_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "room_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      minibar_items: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean | null
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assigned_hotel: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          last_login: string | null
          nickname: string | null
          phone_number: string | null
          profile_picture_url: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string | null
        }
        Insert: {
          assigned_hotel?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id: string
          last_login?: string | null
          nickname?: string | null
          phone_number?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Update: {
          assigned_hotel?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          last_login?: string | null
          nickname?: string | null
          phone_number?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Relationships: []
      }
      room_assignments: {
        Row: {
          assigned_by: string
          assigned_to: string
          assignment_date: string
          assignment_type: Database["public"]["Enums"]["assignment_type"]
          completed_at: string | null
          created_at: string
          estimated_duration: number | null
          id: string
          notes: string | null
          priority: number
          room_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          updated_at: string
        }
        Insert: {
          assigned_by: string
          assigned_to: string
          assignment_date?: string
          assignment_type?: Database["public"]["Enums"]["assignment_type"]
          completed_at?: string | null
          created_at?: string
          estimated_duration?: number | null
          id?: string
          notes?: string | null
          priority?: number
          room_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          assigned_to?: string
          assignment_date?: string
          assignment_type?: Database["public"]["Enums"]["assignment_type"]
          completed_at?: string | null
          created_at?: string
          estimated_duration?: number | null
          id?: string
          notes?: string | null
          priority?: number
          room_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_room_assignments_assigned_by"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_room_assignments_assigned_to"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_room_assignments_room_id"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_minibar_usage: {
        Row: {
          created_at: string
          guest_checkout_date: string | null
          id: string
          is_cleared: boolean | null
          minibar_item_id: string
          quantity_used: number | null
          recorded_by: string | null
          room_id: string
          updated_at: string
          usage_date: string | null
        }
        Insert: {
          created_at?: string
          guest_checkout_date?: string | null
          id?: string
          is_cleared?: boolean | null
          minibar_item_id: string
          quantity_used?: number | null
          recorded_by?: string | null
          room_id: string
          updated_at?: string
          usage_date?: string | null
        }
        Update: {
          created_at?: string
          guest_checkout_date?: string | null
          id?: string
          is_cleared?: boolean | null
          minibar_item_id?: string
          quantity_used?: number | null
          recorded_by?: string | null
          room_id?: string
          updated_at?: string
          usage_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_minibar_usage_minibar_item_id_fkey"
            columns: ["minibar_item_id"]
            isOneToOne: false
            referencedRelation: "minibar_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_minibar_usage_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_minibar_usage_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          bed_type: string | null
          created_at: string
          floor_number: number | null
          hotel: string
          id: string
          last_cleaned_at: string | null
          last_cleaned_by: string | null
          notes: string | null
          room_name: string | null
          room_number: string
          room_type: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          bed_type?: string | null
          created_at?: string
          floor_number?: number | null
          hotel: string
          id?: string
          last_cleaned_at?: string | null
          last_cleaned_by?: string | null
          notes?: string | null
          room_name?: string | null
          room_number: string
          room_type?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          bed_type?: string | null
          created_at?: string
          floor_number?: number | null
          hotel?: string
          id?: string
          last_cleaned_at?: string | null
          last_cleaned_by?: string | null
          notes?: string | null
          room_name?: string | null
          room_number?: string
          room_type?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_last_cleaned_by_fkey"
            columns: ["last_cleaned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_categories: {
        Row: {
          category_key: string
          category_name: string
          created_at: string
          department: Database["public"]["Enums"]["user_role"]
          id: string
          sub_category_key: string | null
          sub_category_name: string | null
          sub_sub_category_key: string | null
          sub_sub_category_name: string | null
        }
        Insert: {
          category_key: string
          category_name: string
          created_at?: string
          department: Database["public"]["Enums"]["user_role"]
          id?: string
          sub_category_key?: string | null
          sub_category_name?: string | null
          sub_sub_category_key?: string | null
          sub_sub_category_name?: string | null
        }
        Update: {
          category_key?: string
          category_name?: string
          created_at?: string
          department?: Database["public"]["Enums"]["user_role"]
          id?: string
          sub_category_key?: string | null
          sub_category_name?: string | null
          sub_sub_category_key?: string | null
          sub_sub_category_name?: string | null
        }
        Relationships: []
      }
      ticket_creation_config: {
        Row: {
          can_create: boolean
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"] | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          can_create?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"] | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          can_create?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"] | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tickets: {
        Row: {
          assigned_to: string | null
          attachment_urls: string[] | null
          category: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string | null
          created_by: string
          department: string | null
          description: string
          hotel: string | null
          id: string
          photo_url: string | null
          priority: Database["public"]["Enums"]["ticket_priority"]
          resolution_text: string | null
          room_number: string
          sla_breach_reason: string | null
          sla_due_date: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          sub_category: string | null
          sub_sub_category: string | null
          ticket_number: string
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          attachment_urls?: string[] | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          created_by: string
          department?: string | null
          description: string
          hotel?: string | null
          id?: string
          photo_url?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          resolution_text?: string | null
          room_number: string
          sla_breach_reason?: string | null
          sla_due_date?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          sub_category?: string | null
          sub_sub_category?: string | null
          ticket_number: string
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          attachment_urls?: string[] | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          created_by?: string
          department?: string | null
          description?: string
          hotel?: string | null
          id?: string
          photo_url?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          resolution_text?: string | null
          room_number?: string
          sla_breach_reason?: string | null
          sla_due_date?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          sub_category?: string | null
          sub_sub_category?: string | null
          ticket_number?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_user_with_profile: {
        Args: {
          p_assigned_hotel?: string
          p_email: string
          p_full_name: string
          p_password: string
          p_phone_number?: string
          p_role?: Database["public"]["Enums"]["user_role"]
        }
        Returns: Json
      }
      delete_user_profile: {
        Args: { p_user_id: string }
        Returns: Json
      }
      generate_ticket_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_assignable_staff: {
        Args: { requesting_user_role: Database["public"]["Enums"]["user_role"] }
        Returns: {
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      get_assignable_staff_secure: {
        Args: { requesting_user_role: Database["public"]["Enums"]["user_role"] }
        Returns: {
          full_name: string
          id: string
          nickname: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      get_current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_hotel_name_from_id: {
        Args: { hotel_id: string }
        Returns: string
      }
      get_housekeeper_performance_stats: {
        Args: { days_back?: number; target_housekeeper_id?: string }
        Returns: Json
      }
      get_housekeeping_leaderboard: {
        Args: { days_back?: number }
        Returns: {
          avg_duration_minutes: number
          avg_efficiency_score: number
          full_name: string
          housekeeper_id: string
          rank_position: number
          total_completed: number
        }[]
      }
      get_housekeeping_summary: {
        Args: { target_date?: string; user_id: string }
        Returns: Json
      }
      get_user_access_config: {
        Args: { user_role: Database["public"]["Enums"]["user_role"] }
        Returns: {
          access_scope: string
          can_manage_all: boolean
          department: string
        }[]
      }
      get_user_role: {
        Args: { user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_user_role_safe: {
        Args: { user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      has_ticket_creation_permission: {
        Args: { _user_id: string }
        Returns: boolean
      }
      user_can_view_ticket: {
        Args: { ticket_id: string }
        Returns: boolean
      }
    }
    Enums: {
      assignment_status: "assigned" | "in_progress" | "completed" | "cancelled"
      assignment_type:
        | "daily_cleaning"
        | "checkout_cleaning"
        | "maintenance"
        | "deep_cleaning"
      ticket_priority: "low" | "medium" | "high" | "urgent"
      ticket_status: "open" | "in_progress" | "completed"
      user_role:
        | "housekeeping"
        | "reception"
        | "maintenance"
        | "manager"
        | "admin"
        | "marketing"
        | "control_finance"
        | "hr"
        | "front_office"
        | "top_management"
        | "housekeeping_manager"
        | "maintenance_manager"
        | "marketing_manager"
        | "reception_manager"
        | "back_office_manager"
        | "control_manager"
        | "finance_manager"
        | "top_management_manager"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      assignment_status: ["assigned", "in_progress", "completed", "cancelled"],
      assignment_type: [
        "daily_cleaning",
        "checkout_cleaning",
        "maintenance",
        "deep_cleaning",
      ],
      ticket_priority: ["low", "medium", "high", "urgent"],
      ticket_status: ["open", "in_progress", "completed"],
      user_role: [
        "housekeeping",
        "reception",
        "maintenance",
        "manager",
        "admin",
        "marketing",
        "control_finance",
        "hr",
        "front_office",
        "top_management",
        "housekeeping_manager",
        "maintenance_manager",
        "marketing_manager",
        "reception_manager",
        "back_office_manager",
        "control_manager",
        "finance_manager",
        "top_management_manager",
      ],
    },
  },
} as const
