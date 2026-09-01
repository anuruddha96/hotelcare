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
      ai_budget_settings: {
        Row: {
          competitor_scan_enabled: boolean
          daily_budget_usd: number
          event_sweep_enabled: boolean
          monthly_budget_usd: number
          organization_slug: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          competitor_scan_enabled?: boolean
          daily_budget_usd?: number
          event_sweep_enabled?: boolean
          monthly_budget_usd?: number
          organization_slug: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          competitor_scan_enabled?: boolean
          daily_budget_usd?: number
          event_sweep_enabled?: boolean
          monthly_budget_usd?: number
          organization_slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          created_at: string
          error: string | null
          estimated_cost_usd: number
          function_name: string
          hotel_id: string | null
          id: string
          input_tokens: number
          model: string | null
          ok: boolean
          organization_slug: string | null
          output_tokens: number
          web_searches: number
        }
        Insert: {
          created_at?: string
          error?: string | null
          estimated_cost_usd?: number
          function_name: string
          hotel_id?: string | null
          id?: string
          input_tokens?: number
          model?: string | null
          ok?: boolean
          organization_slug?: string | null
          output_tokens?: number
          web_searches?: number
        }
        Update: {
          created_at?: string
          error?: string | null
          estimated_cost_usd?: number
          function_name?: string
          hotel_id?: string | null
          id?: string
          input_tokens?: number
          model?: string | null
          ok?: boolean
          organization_slug?: string | null
          output_tokens?: number
          web_searches?: number
        }
        Relationships: []
      }
      announcement_receipts: {
        Row: {
          announcement_id: string
          created_at: string
          dismissed_at: string | null
          id: string
          seen_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          seen_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          seen_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_receipts_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "system_announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      archived_housekeepers: {
        Row: {
          archive_expires_at: string
          archived_at: string
          archived_by: string | null
          assigned_hotel: string | null
          attendance_data: Json | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          nickname: string | null
          organization_slug: string | null
          original_profile_id: string
          performance_data: Json | null
          phone_number: string | null
          ratings_data: Json | null
        }
        Insert: {
          archive_expires_at?: string
          archived_at?: string
          archived_by?: string | null
          assigned_hotel?: string | null
          attendance_data?: Json | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          nickname?: string | null
          organization_slug?: string | null
          original_profile_id: string
          performance_data?: Json | null
          phone_number?: string | null
          ratings_data?: Json | null
        }
        Update: {
          archive_expires_at?: string
          archived_at?: string
          archived_by?: string | null
          assigned_hotel?: string | null
          attendance_data?: Json | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          nickname?: string | null
          organization_slug?: string | null
          original_profile_id?: string
          performance_data?: Json | null
          phone_number?: string | null
          ratings_data?: Json | null
        }
        Relationships: []
      }
      assignment_patterns: {
        Row: {
          created_at: string
          hotel: string
          id: string
          last_seen_at: string
          organization_slug: string | null
          pair_count: number
          room_number_a: string
          room_number_b: string
        }
        Insert: {
          created_at?: string
          hotel: string
          id?: string
          last_seen_at?: string
          organization_slug?: string | null
          pair_count?: number
          room_number_a: string
          room_number_b: string
        }
        Update: {
          created_at?: string
          hotel?: string
          id?: string
          last_seen_at?: string
          organization_slug?: string | null
          pair_count?: number
          room_number_a?: string
          room_number_b?: string
        }
        Relationships: []
      }
      assistant_access_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          expires_at: string | null
          hotel_id: string | null
          id: string
          organization_slug: string | null
          question: string
          reason: string | null
          requested_scope: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string | null
          hotel_id?: string | null
          id?: string
          organization_slug?: string | null
          question?: string
          reason?: string | null
          requested_scope: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          expires_at?: string | null
          hotel_id?: string | null
          id?: string
          organization_slug?: string | null
          question?: string
          reason?: string | null
          requested_scope?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_audit_log: {
        Row: {
          created_at: string
          hotel_id: string | null
          id: string
          model: string | null
          organization_slug: string | null
          question: string
          refused: boolean
          role: string | null
          scopes_used: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          hotel_id?: string | null
          id?: string
          model?: string | null
          organization_slug?: string | null
          question?: string
          refused?: boolean
          role?: string | null
          scopes_used?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          hotel_id?: string | null
          id?: string
          model?: string | null
          organization_slug?: string | null
          question?: string
          refused?: boolean
          role?: string | null
          scopes_used?: string[]
          user_id?: string
        }
        Relationships: []
      }
      assistant_feedback: {
        Row: {
          created_at: string
          helpful: boolean
          hotel_id: string | null
          id: string
          message_id: string | null
          organization_slug: string | null
          reason: string | null
          thread_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          helpful: boolean
          hotel_id?: string | null
          id?: string
          message_id?: string | null
          organization_slug?: string | null
          reason?: string | null
          thread_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          helpful?: boolean
          hotel_id?: string | null
          id?: string
          message_id?: string | null
          organization_slug?: string | null
          reason?: string | null
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_feedback_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "assistant_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_issue_reports: {
        Row: {
          admin_notes: string | null
          ai_summary: string | null
          app_language: string | null
          category: string
          created_at: string
          current_route: string | null
          device: string | null
          entity_id: string | null
          entity_type: string | null
          hotel_id: string | null
          id: string
          module: string | null
          organization_slug: string | null
          resolved_at: string | null
          severity: string
          status: string
          tab: string | null
          thread_id: string | null
          title: string
          updated_at: string
          user_description: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          ai_summary?: string | null
          app_language?: string | null
          category?: string
          created_at?: string
          current_route?: string | null
          device?: string | null
          entity_id?: string | null
          entity_type?: string | null
          hotel_id?: string | null
          id?: string
          module?: string | null
          organization_slug?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          tab?: string | null
          thread_id?: string | null
          title: string
          updated_at?: string
          user_description?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          ai_summary?: string | null
          app_language?: string | null
          category?: string
          created_at?: string
          current_route?: string | null
          device?: string | null
          entity_id?: string | null
          entity_type?: string | null
          hotel_id?: string | null
          id?: string
          module?: string | null
          organization_slug?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          tab?: string | null
          thread_id?: string | null
          title?: string
          updated_at?: string
          user_description?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_issue_reports_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "assistant_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          model: string | null
          refused: boolean
          role: string
          scopes_used: string[]
          thread_id: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          model?: string | null
          refused?: boolean
          role: string
          scopes_used?: string[]
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          model?: string | null
          refused?: boolean
          role?: string
          scopes_used?: string[]
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "assistant_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_paid_questions: {
        Row: {
          amount_eur: number
          created_at: string
          hotel_id: string | null
          id: string
          organization_slug: string | null
          question: string | null
          user_id: string
        }
        Insert: {
          amount_eur?: number
          created_at?: string
          hotel_id?: string | null
          id?: string
          organization_slug?: string | null
          question?: string | null
          user_id: string
        }
        Update: {
          amount_eur?: number
          created_at?: string
          hotel_id?: string | null
          id?: string
          organization_slug?: string | null
          question?: string | null
          user_id?: string
        }
        Relationships: []
      }
      assistant_threads: {
        Row: {
          created_at: string
          hotel_id: string | null
          id: string
          organization_slug: string | null
          title: string
          title_locked: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hotel_id?: string | null
          id?: string
          organization_slug?: string | null
          title?: string
          title_locked?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hotel_id?: string | null
          id?: string
          organization_slug?: string | null
          title?: string
          title_locked?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      autopilot_decisions: {
        Row: {
          after_rate_eur: number | null
          before_rate_eur: number | null
          created_at: string
          decision_type: string
          delta_eur: number | null
          hotel_id: string
          id: string
          meta: Json
          organization_slug: string
          reason: string | null
          stay_date: string
        }
        Insert: {
          after_rate_eur?: number | null
          before_rate_eur?: number | null
          created_at?: string
          decision_type: string
          delta_eur?: number | null
          hotel_id: string
          id?: string
          meta?: Json
          organization_slug: string
          reason?: string | null
          stay_date: string
        }
        Update: {
          after_rate_eur?: number | null
          before_rate_eur?: number | null
          created_at?: string
          decision_type?: string
          delta_eur?: number | null
          hotel_id?: string
          id?: string
          meta?: Json
          organization_slug?: string
          reason?: string | null
          stay_date?: string
        }
        Relationships: []
      }
      benchmark_snapshots: {
        Row: {
          captured_at: string
          comparison_value: number | null
          day: string
          hotel_id: string
          id: string
          market_id: string | null
          metric: string
          organization_slug: string
          value: number | null
        }
        Insert: {
          captured_at?: string
          comparison_value?: number | null
          day: string
          hotel_id: string
          id?: string
          market_id?: string | null
          metric: string
          organization_slug: string
          value?: number | null
        }
        Update: {
          captured_at?: string
          comparison_value?: number | null
          day?: string
          hotel_id?: string
          id?: string
          market_id?: string | null
          metric?: string
          organization_slug?: string
          value?: number | null
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          created_at: string
          event_type: string | null
          id: string
          organization_slug: string | null
          payload: Json | null
          stripe_event_id: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          id?: string
          organization_slug?: string | null
          payload?: Json | null
          stripe_event_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string | null
          id?: string
          organization_slug?: string | null
          payload?: Json | null
          stripe_event_id?: string | null
        }
        Relationships: []
      }
      billing_hotel_overrides: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          organization_slug: string
          room_count: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          organization_slug: string
          room_count?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          organization_slug?: string
          room_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      billing_revenue_usage: {
        Row: {
          billed_at: string | null
          created_at: string
          currency: string
          fee_cents: number
          hotel_id: string
          id: string
          organization_slug: string
          percent_bps: number
          period_month: string
          realised_revenue_cents: number
          room_nights: number
          stripe_invoice_item_id: string | null
          updated_at: string
        }
        Insert: {
          billed_at?: string | null
          created_at?: string
          currency?: string
          fee_cents?: number
          hotel_id: string
          id?: string
          organization_slug: string
          percent_bps?: number
          period_month: string
          realised_revenue_cents?: number
          room_nights?: number
          stripe_invoice_item_id?: string | null
          updated_at?: string
        }
        Update: {
          billed_at?: string | null
          created_at?: string
          currency?: string
          fee_cents?: number
          hotel_id?: string
          id?: string
          organization_slug?: string
          percent_bps?: number
          period_month?: string
          realised_revenue_cents?: number
          room_nights?: number
          stripe_invoice_item_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      billing_settings: {
        Row: {
          billing_address_city: string | null
          billing_address_country: string | null
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_address_postal_code: string | null
          billing_company_name: string | null
          billing_tax_id: string | null
          created_at: string
          currency: string
          early_bird_enabled: boolean
          early_bird_ends_at: string | null
          early_bird_label: string
          early_bird_note: string
          grace_days: number
          id: string
          maintenance_module_enabled: boolean
          maintenance_price_cents: number
          maintenance_pricing_mode: string
          operations_module_enabled: boolean
          operations_module_label: string
          operations_price_cents: number
          organization_slug: string
          payments_enabled: boolean
          revenue_automation_price_cents: number
          revenue_bi_price_cents: number
          revenue_module_enabled: boolean
          revenue_percent_bps: number
          revenue_percent_cap_cents: number
          revenue_percent_min_cents: number
          revenue_price_cents: number
          revenue_pricing_mode: string
          standard_operations_price_cents: number
          standard_revenue_automation_price_cents: number
          standard_revenue_bi_price_cents: number
          stripe_publishable_key: string | null
          trial_enabled: boolean
          trial_months: number
          trial_start: string
          updated_at: string
          vat_percent: number
        }
        Insert: {
          billing_address_city?: string | null
          billing_address_country?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_address_postal_code?: string | null
          billing_company_name?: string | null
          billing_tax_id?: string | null
          created_at?: string
          currency?: string
          early_bird_enabled?: boolean
          early_bird_ends_at?: string | null
          early_bird_label?: string
          early_bird_note?: string
          grace_days?: number
          id?: string
          maintenance_module_enabled?: boolean
          maintenance_price_cents?: number
          maintenance_pricing_mode?: string
          operations_module_enabled?: boolean
          operations_module_label?: string
          operations_price_cents?: number
          organization_slug: string
          payments_enabled?: boolean
          revenue_automation_price_cents?: number
          revenue_bi_price_cents?: number
          revenue_module_enabled?: boolean
          revenue_percent_bps?: number
          revenue_percent_cap_cents?: number
          revenue_percent_min_cents?: number
          revenue_price_cents?: number
          revenue_pricing_mode?: string
          standard_operations_price_cents?: number
          standard_revenue_automation_price_cents?: number
          standard_revenue_bi_price_cents?: number
          stripe_publishable_key?: string | null
          trial_enabled?: boolean
          trial_months?: number
          trial_start?: string
          updated_at?: string
          vat_percent?: number
        }
        Update: {
          billing_address_city?: string | null
          billing_address_country?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_address_postal_code?: string | null
          billing_company_name?: string | null
          billing_tax_id?: string | null
          created_at?: string
          currency?: string
          early_bird_enabled?: boolean
          early_bird_ends_at?: string | null
          early_bird_label?: string
          early_bird_note?: string
          grace_days?: number
          id?: string
          maintenance_module_enabled?: boolean
          maintenance_price_cents?: number
          maintenance_pricing_mode?: string
          operations_module_enabled?: boolean
          operations_module_label?: string
          operations_price_cents?: number
          organization_slug?: string
          payments_enabled?: boolean
          revenue_automation_price_cents?: number
          revenue_bi_price_cents?: number
          revenue_module_enabled?: boolean
          revenue_percent_bps?: number
          revenue_percent_cap_cents?: number
          revenue_percent_min_cents?: number
          revenue_price_cents?: number
          revenue_pricing_mode?: string
          standard_operations_price_cents?: number
          standard_revenue_automation_price_cents?: number
          standard_revenue_bi_price_cents?: number
          stripe_publishable_key?: string | null
          trial_enabled?: boolean
          trial_months?: number
          trial_start?: string
          updated_at?: string
          vat_percent?: number
        }
        Relationships: []
      }
      booking_velocity_events: {
        Row: {
          acted: boolean
          arrivals_in_window: number
          created_at: string
          detected_at: string
          hotel_id: string
          id: string
          organization_slug: string
          rate_recommendation_id: string | null
          recommended_increase_eur: number
          stay_date: string
          window_minutes: number
        }
        Insert: {
          acted?: boolean
          arrivals_in_window: number
          created_at?: string
          detected_at?: string
          hotel_id: string
          id?: string
          organization_slug: string
          rate_recommendation_id?: string | null
          recommended_increase_eur: number
          stay_date: string
          window_minutes?: number
        }
        Update: {
          acted?: boolean
          arrivals_in_window?: number
          created_at?: string
          detected_at?: string
          hotel_id?: string
          id?: string
          organization_slug?: string
          rate_recommendation_id?: string | null
          recommended_increase_eur?: number
          stay_date?: string
          window_minutes?: number
        }
        Relationships: []
      }
      break_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          break_type_id: string
          created_at: string
          id: string
          organization_slug: string | null
          reason: string
          rejection_reason: string | null
          requested_at: string
          requested_by: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          break_type_id: string
          created_at?: string
          id?: string
          organization_slug?: string | null
          reason: string
          rejection_reason?: string | null
          requested_at?: string
          requested_by: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          break_type_id?: string
          created_at?: string
          id?: string
          organization_slug?: string | null
          reason?: string
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "break_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_requests_break_type_id_fkey"
            columns: ["break_type_id"]
            isOneToOne: false
            referencedRelation: "break_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      break_types: {
        Row: {
          created_at: string
          display_name: string
          duration_minutes: number
          icon_name: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          duration_minutes: number
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          duration_minutes?: number
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      breakfast_attendance: {
        Row: {
          created_at: string
          guest_names: string[] | null
          hotel_id: string
          id: string
          location: string
          organization_slug: string | null
          room_number: string
          served_by: string | null
          served_count: number
          stay_date: string
        }
        Insert: {
          created_at?: string
          guest_names?: string[] | null
          hotel_id: string
          id?: string
          location: string
          organization_slug?: string | null
          room_number: string
          served_by?: string | null
          served_count?: number
          stay_date: string
        }
        Update: {
          created_at?: string
          guest_names?: string[] | null
          hotel_id?: string
          id?: string
          location?: string
          organization_slug?: string | null
          room_number?: string
          served_by?: string | null
          served_count?: number
          stay_date?: string
        }
        Relationships: []
      }
      breakfast_roster: {
        Row: {
          all_inclusive_count: number
          breakfast_count: number
          dinner_count: number
          guest_names: string[]
          hotel_id: string
          id: string
          lunch_count: number
          organization_slug: string
          pax: number
          room_number: string
          source_notes: string | null
          stay_date: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          all_inclusive_count?: number
          breakfast_count?: number
          dinner_count?: number
          guest_names?: string[]
          hotel_id: string
          id?: string
          lunch_count?: number
          organization_slug: string
          pax?: number
          room_number: string
          source_notes?: string | null
          stay_date: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          all_inclusive_count?: number
          breakfast_count?: number
          dinner_count?: number
          guest_names?: string[]
          hotel_id?: string
          id?: string
          lunch_count?: number
          organization_slug?: string
          pax?: number
          room_number?: string
          source_notes?: string | null
          stay_date?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breakfast_roster_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_rate_mappings: {
        Row: {
          channel_id: string
          channel_rate_code: string | null
          created_at: string
          id: string
          is_active: boolean | null
          markup_percent: number | null
          rate_plan_id: string
        }
        Insert: {
          channel_id: string
          channel_rate_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          markup_percent?: number | null
          rate_plan_id: string
        }
        Update: {
          channel_id?: string
          channel_rate_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          markup_percent?: number | null
          rate_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_rate_mappings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_rate_mappings_rate_plan_id_fkey"
            columns: ["rate_plan_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          api_endpoint: string | null
          api_key_ref: string | null
          channel_name: string
          channel_type: string | null
          created_at: string
          hotel_id: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          organization_slug: string | null
          settings: Json | null
          sync_status: string | null
          updated_at: string
        }
        Insert: {
          api_endpoint?: string | null
          api_key_ref?: string | null
          channel_name: string
          channel_type?: string | null
          created_at?: string
          hotel_id?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_slug?: string | null
          settings?: Json | null
          sync_status?: string | null
          updated_at?: string
        }
        Update: {
          api_endpoint?: string | null
          api_key_ref?: string | null
          channel_name?: string
          channel_type?: string | null
          created_at?: string
          hotel_id?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_slug?: string | null
          settings?: Json | null
          sync_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      client_error_logs: {
        Row: {
          component_stack: string | null
          context: string | null
          created_at: string
          device_memory: string | null
          error_message: string
          error_stack: string | null
          hotel: string | null
          id: string
          last_action: string | null
          organization_slug: string | null
          route: string | null
          screen_size: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          component_stack?: string | null
          context?: string | null
          created_at?: string
          device_memory?: string | null
          error_message: string
          error_stack?: string | null
          hotel?: string | null
          id?: string
          last_action?: string | null
          organization_slug?: string | null
          route?: string | null
          screen_size?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          component_stack?: string | null
          context?: string | null
          created_at?: string
          device_memory?: string | null
          error_message?: string
          error_stack?: string | null
          hotel?: string | null
          id?: string
          last_action?: string | null
          organization_slug?: string | null
          route?: string | null
          screen_size?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          image_url: string | null
          organization_slug: string | null
          ticket_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          organization_slug?: string | null
          ticket_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          image_url?: string | null
          organization_slug?: string | null
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
      competitor_properties: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          hotel_id: string
          id: string
          last_scan_at: string | null
          last_scan_error: string | null
          last_scan_prices: number
          last_scan_status: string | null
          name: string
          notes: string | null
          organization_slug: string
          scan_tier: number
          source_url: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          hotel_id: string
          id?: string
          last_scan_at?: string | null
          last_scan_error?: string | null
          last_scan_prices?: number
          last_scan_status?: string | null
          name: string
          notes?: string | null
          organization_slug: string
          scan_tier?: number
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          hotel_id?: string
          id?: string
          last_scan_at?: string | null
          last_scan_error?: string | null
          last_scan_prices?: number
          last_scan_status?: string | null
          name?: string
          notes?: string | null
          organization_slug?: string
          scan_tier?: number
          source_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      competitor_rate_observations: {
        Row: {
          board: string | null
          competitor_id: string
          currency: string | null
          hotel_id: string
          id: string
          model: string | null
          observed_at: string
          occupancy: number | null
          organization_slug: string | null
          rate: number | null
          raw_confidence: number | null
          refundable: boolean | null
          room_type: string | null
          run_id: string | null
          source_page_url: string | null
          stay_date: string
        }
        Insert: {
          board?: string | null
          competitor_id: string
          currency?: string | null
          hotel_id: string
          id?: string
          model?: string | null
          observed_at?: string
          occupancy?: number | null
          organization_slug?: string | null
          rate?: number | null
          raw_confidence?: number | null
          refundable?: boolean | null
          room_type?: string | null
          run_id?: string | null
          source_page_url?: string | null
          stay_date: string
        }
        Update: {
          board?: string | null
          competitor_id?: string
          currency?: string | null
          hotel_id?: string
          id?: string
          model?: string | null
          observed_at?: string
          occupancy?: number | null
          organization_slug?: string | null
          rate?: number | null
          raw_confidence?: number | null
          refundable?: boolean | null
          room_type?: string | null
          run_id?: string | null
          source_page_url?: string | null
          stay_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_rate_observations_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitor_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_rates: {
        Row: {
          board: string | null
          captured_at: string
          competitor_id: string
          confidence: number | null
          created_at: string
          currency: string
          currency_original: string | null
          hotel_id: string
          id: string
          occupancy: number | null
          organization_slug: string
          rate: number | null
          rate_original: number | null
          refundable: boolean | null
          room_type: string | null
          source: string | null
          source_page_url: string | null
          stay_date: string
        }
        Insert: {
          board?: string | null
          captured_at?: string
          competitor_id: string
          confidence?: number | null
          created_at?: string
          currency?: string
          currency_original?: string | null
          hotel_id: string
          id?: string
          occupancy?: number | null
          organization_slug: string
          rate?: number | null
          rate_original?: number | null
          refundable?: boolean | null
          room_type?: string | null
          source?: string | null
          source_page_url?: string | null
          stay_date: string
        }
        Update: {
          board?: string | null
          captured_at?: string
          competitor_id?: string
          confidence?: number | null
          created_at?: string
          currency?: string
          currency_original?: string | null
          hotel_id?: string
          id?: string
          occupancy?: number | null
          organization_slug?: string
          rate?: number | null
          rate_original?: number | null
          refundable?: boolean | null
          room_type?: string | null
          source?: string | null
          source_page_url?: string | null
          stay_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_rates_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitor_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_scan_lease: {
        Row: {
          id: string
          locked_until: string
          pause_reason: string | null
          paused_until: string | null
          updated_at: string
        }
        Insert: {
          id: string
          locked_until: string
          pause_reason?: string | null
          paused_until?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          locked_until?: string
          pause_reason?: string | null
          paused_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      competitor_scan_runs: {
        Row: {
          competitor_id: string | null
          dates_requested: number
          error: string | null
          finished_at: string | null
          hotel_id: string
          id: string
          model: string | null
          organization_slug: string | null
          prices_found: number
          started_at: string
          status: string
          window_from: string | null
          window_to: string | null
        }
        Insert: {
          competitor_id?: string | null
          dates_requested?: number
          error?: string | null
          finished_at?: string | null
          hotel_id: string
          id?: string
          model?: string | null
          organization_slug?: string | null
          prices_found?: number
          started_at?: string
          status?: string
          window_from?: string | null
          window_to?: string | null
        }
        Update: {
          competitor_id?: string | null
          dates_requested?: number
          error?: string | null
          finished_at?: string | null
          hotel_id?: string
          id?: string
          model?: string | null
          organization_slug?: string | null
          prices_found?: number
          started_at?: string
          status?: string
          window_from?: string | null
          window_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_scan_runs_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitor_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_overview_meal_totals: {
        Row: {
          adults: number | null
          all_inclusive: number | null
          breakfast: number | null
          business_date: string
          captured_at: string
          children: number | null
          dinner: number | null
          hotel_id: string
          id: string
          lunch: number | null
          organization_slug: string | null
          source_filename: string | null
          uploaded_by: string | null
        }
        Insert: {
          adults?: number | null
          all_inclusive?: number | null
          breakfast?: number | null
          business_date: string
          captured_at?: string
          children?: number | null
          dinner?: number | null
          hotel_id: string
          id?: string
          lunch?: number | null
          organization_slug?: string | null
          source_filename?: string | null
          uploaded_by?: string | null
        }
        Update: {
          adults?: number | null
          all_inclusive?: number | null
          breakfast?: number | null
          business_date?: string
          captured_at?: string
          children?: number | null
          dinner?: number | null
          hotel_id?: string
          id?: string
          lunch?: number | null
          organization_slug?: string | null
          source_filename?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      daily_overview_snapshots: {
        Row: {
          all_inclusive: number | null
          arrival_date: string | null
          breakfast: number | null
          business_date: string
          captured_at: string
          departure_date: string | null
          dinner: number | null
          guest_names: string | null
          hotel_id: string
          housekeeping_dep: string | null
          housekeeping_stay: string | null
          id: string
          lunch: number | null
          organization_slug: string | null
          pax: number | null
          room_label: string | null
          room_number: string | null
          room_suffix: string | null
          room_type_code: string | null
          source: string
          source_filename: string | null
          status: string | null
          uploaded_by: string | null
        }
        Insert: {
          all_inclusive?: number | null
          arrival_date?: string | null
          breakfast?: number | null
          business_date: string
          captured_at?: string
          departure_date?: string | null
          dinner?: number | null
          guest_names?: string | null
          hotel_id: string
          housekeeping_dep?: string | null
          housekeeping_stay?: string | null
          id?: string
          lunch?: number | null
          organization_slug?: string | null
          pax?: number | null
          room_label?: string | null
          room_number?: string | null
          room_suffix?: string | null
          room_type_code?: string | null
          source?: string
          source_filename?: string | null
          status?: string | null
          uploaded_by?: string | null
        }
        Update: {
          all_inclusive?: number | null
          arrival_date?: string | null
          breakfast?: number | null
          business_date?: string
          captured_at?: string
          departure_date?: string | null
          dinner?: number | null
          guest_names?: string | null
          hotel_id?: string
          housekeeping_dep?: string | null
          housekeeping_stay?: string | null
          id?: string
          lunch?: number | null
          organization_slug?: string | null
          pax?: number | null
          room_label?: string | null
          room_number?: string | null
          room_suffix?: string | null
          room_type_code?: string | null
          source?: string
          source_filename?: string | null
          status?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      daily_rates: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          occupancy_pct: number | null
          organization_slug: string
          rate_eur: number
          source: string
          stay_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          occupancy_pct?: number | null
          organization_slug: string
          rate_eur: number
          source?: string
          stay_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          occupancy_pct?: number | null
          organization_slug?: string
          rate_eur?: number
          source?: string
          stay_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      demand_event_search_runs: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          error: string | null
          events_added: number
          events_found: number
          hotel_id: string | null
          id: string
          month: string | null
          months_scanned: number
          organization_slug: string
          run_by: string | null
          run_by_name: string | null
          source: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          error?: string | null
          events_added?: number
          events_found?: number
          hotel_id?: string | null
          id?: string
          month?: string | null
          months_scanned?: number
          organization_slug: string
          run_by?: string | null
          run_by_name?: string | null
          source?: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          error?: string | null
          events_added?: number
          events_found?: number
          hotel_id?: string | null
          id?: string
          month?: string | null
          months_scanned?: number
          organization_slug?: string
          run_by?: string | null
          run_by_name?: string | null
          source?: string
        }
        Relationships: []
      }
      demand_events: {
        Row: {
          approved: boolean
          category: string
          city: string
          confidence: number | null
          country: string
          created_at: string
          created_by: string | null
          end_date: string | null
          event_date: string
          expected_impact: string
          hotel_id: string | null
          id: string
          notes: string | null
          organization_slug: string
          recurs_annually: boolean
          source: string
          surcharge_eur: number | null
          title: string
          updated_at: string
          url: string | null
          venue: string | null
        }
        Insert: {
          approved?: boolean
          category?: string
          city?: string
          confidence?: number | null
          country?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          event_date: string
          expected_impact?: string
          hotel_id?: string | null
          id?: string
          notes?: string | null
          organization_slug: string
          recurs_annually?: boolean
          source?: string
          surcharge_eur?: number | null
          title: string
          updated_at?: string
          url?: string | null
          venue?: string | null
        }
        Update: {
          approved?: boolean
          category?: string
          city?: string
          confidence?: number | null
          country?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          event_date?: string
          expected_impact?: string
          hotel_id?: string | null
          id?: string
          notes?: string | null
          organization_slug?: string
          recurs_annually?: boolean
          source?: string
          surcharge_eur?: number | null
          title?: string
          updated_at?: string
          url?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      demand_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          hotel_id: string
          id: string
          note: string | null
          organization_slug: string | null
          score: number
          stay_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hotel_id: string
          id?: string
          note?: string | null
          organization_slug?: string | null
          score: number
          stay_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hotel_id?: string
          id?: string
          note?: string | null
          organization_slug?: string | null
          score?: number
          stay_date?: string
          updated_at?: string
        }
        Relationships: []
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
      dirty_linen_counts: {
        Row: {
          assignment_id: string | null
          count: number
          created_at: string
          housekeeper_id: string
          id: string
          linen_item_id: string
          organization_slug: string | null
          room_id: string
          updated_at: string
          work_date: string
        }
        Insert: {
          assignment_id?: string | null
          count?: number
          created_at?: string
          housekeeper_id: string
          id?: string
          linen_item_id: string
          organization_slug?: string | null
          room_id: string
          updated_at?: string
          work_date?: string
        }
        Update: {
          assignment_id?: string | null
          count?: number
          created_at?: string
          housekeeper_id?: string
          id?: string
          linen_item_id?: string
          organization_slug?: string | null
          room_id?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "dirty_linen_counts_linen_item_id_fkey"
            columns: ["linen_item_id"]
            isOneToOne: false
            referencedRelation: "dirty_linen_items"
            referencedColumns: ["id"]
          },
        ]
      }
      dirty_linen_items: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      dnd_photos: {
        Row: {
          assignment_date: string
          assignment_id: string | null
          attempt_number: number
          created_at: string
          id: string
          marked_at: string
          marked_by: string
          notes: string | null
          organization_slug: string | null
          photo_url: string
          room_id: string
          updated_at: string
        }
        Insert: {
          assignment_date?: string
          assignment_id?: string | null
          attempt_number?: number
          created_at?: string
          id?: string
          marked_at?: string
          marked_by: string
          notes?: string | null
          organization_slug?: string | null
          photo_url: string
          room_id: string
          updated_at?: string
        }
        Update: {
          assignment_date?: string
          assignment_id?: string | null
          attempt_number?: number
          created_at?: string
          id?: string
          marked_at?: string
          marked_by?: string
          notes?: string | null
          organization_slug?: string | null
          photo_url?: string
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dnd_photos_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_dnd_photos_marked_by"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dow_adjustments: {
        Row: {
          dow: number
          hotel_id: string
          organization_slug: string
          percent: number
          updated_at: string
        }
        Insert: {
          dow: number
          hotel_id: string
          organization_slug: string
          percent?: number
          updated_at?: string
        }
        Update: {
          dow?: number
          hotel_id?: string
          organization_slug?: string
          percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      early_signout_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attendance_id: string
          created_at: string
          id: string
          organization_slug: string | null
          pending_rooms_info: Json | null
          rejection_reason: string | null
          request_reason: string | null
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_id: string
          created_at?: string
          id?: string
          organization_slug?: string | null
          pending_rooms_info?: Json | null
          rejection_reason?: string | null
          request_reason?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_id?: string
          created_at?: string
          id?: string
          organization_slug?: string | null
          pending_rooms_info?: Json | null
          rejection_reason?: string | null
          request_reason?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "early_signout_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "early_signout_requests_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "staff_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "early_signout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          created_at: string
          digest_enabled: boolean
          from_email: string
          from_name: string
          organization_slug: string
          reply_to: string | null
          transactional_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          digest_enabled?: boolean
          from_email?: string
          from_name?: string
          organization_slug: string
          reply_to?: string | null
          transactional_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          digest_enabled?: boolean
          from_email?: string
          from_name?: string
          organization_slug?: string
          reply_to?: string | null
          transactional_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      finance_access: {
        Row: {
          created_at: string
          id: string
          organization_slug: string
          profile: Database["public"]["Enums"]["finance_profile"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_slug: string
          profile?: Database["public"]["Enums"]["finance_profile"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_slug?: string
          profile?: Database["public"]["Enums"]["finance_profile"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_access_companies: {
        Row: {
          company_id: string
          finance_access_id: string
          id: string
        }
        Insert: {
          company_id: string
          finance_access_id: string
          id?: string
        }
        Update: {
          company_id?: string
          finance_access_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_access_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "invoice_buyer_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_access_companies_finance_access_id_fkey"
            columns: ["finance_access_id"]
            isOneToOne: false
            referencedRelation: "finance_access"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_access_properties: {
        Row: {
          finance_access_id: string
          hotel_id: string
          id: string
        }
        Insert: {
          finance_access_id: string
          hotel_id: string
          id?: string
        }
        Update: {
          finance_access_id?: string
          hotel_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_access_properties_finance_access_id_fkey"
            columns: ["finance_access_id"]
            isOneToOne: false
            referencedRelation: "finance_access"
            referencedColumns: ["id"]
          },
        ]
      }
      general_tasks: {
        Row: {
          assigned_by: string
          assigned_date: string
          assigned_to: string
          completed_at: string | null
          completion_photos: string[] | null
          created_at: string
          estimated_duration: number | null
          hotel: string
          id: string
          notes: string | null
          organization_slug: string | null
          priority: number
          started_at: string | null
          status: string
          task_description: string | null
          task_name: string
          task_type: string
          updated_at: string
        }
        Insert: {
          assigned_by: string
          assigned_date?: string
          assigned_to: string
          completed_at?: string | null
          completion_photos?: string[] | null
          created_at?: string
          estimated_duration?: number | null
          hotel: string
          id?: string
          notes?: string | null
          organization_slug?: string | null
          priority?: number
          started_at?: string | null
          status?: string
          task_description?: string | null
          task_name: string
          task_type?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          assigned_date?: string
          assigned_to?: string
          completed_at?: string | null
          completion_photos?: string[] | null
          created_at?: string
          estimated_duration?: number | null
          hotel?: string
          id?: string
          notes?: string | null
          organization_slug?: string | null
          priority?: number
          started_at?: string | null
          status?: string
          task_description?: string | null
          task_name?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      guest_folios: {
        Row: {
          amount: number
          charge_date: string
          charge_type: string | null
          created_at: string
          created_by: string | null
          description: string
          guest_id: string | null
          id: string
          reservation_id: string | null
        }
        Insert: {
          amount?: number
          charge_date?: string
          charge_type?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          guest_id?: string | null
          id?: string
          reservation_id?: string | null
        }
        Update: {
          amount?: number
          charge_date?: string
          charge_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          guest_id?: string | null
          id?: string
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_folios_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_folios_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_recommendations: {
        Row: {
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          map_url: string | null
          name: string
          sort_order: number | null
          specialty: string | null
          translations: Json | null
          type: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          map_url?: string | null
          name: string
          sort_order?: number | null
          specialty?: string | null
          translations?: Json | null
          type: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          map_url?: string | null
          name?: string
          sort_order?: number | null
          specialty?: string | null
          translations?: Json | null
          type?: string
        }
        Relationships: []
      }
      guests: {
        Row: {
          address: string | null
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          first_name: string
          hotel_id: string | null
          id: string
          id_document_number: string | null
          id_document_type: string | null
          last_name: string
          nationality: string | null
          notes: string | null
          organization_slug: string | null
          phone: string | null
          postal_code: string | null
          preferences: Json | null
          szallas_registration_number: string | null
          tax_id: string | null
          updated_at: string
          vip_status: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name: string
          hotel_id?: string | null
          id?: string
          id_document_number?: string | null
          id_document_type?: string | null
          last_name: string
          nationality?: string | null
          notes?: string | null
          organization_slug?: string | null
          phone?: string | null
          postal_code?: string | null
          preferences?: Json | null
          szallas_registration_number?: string | null
          tax_id?: string | null
          updated_at?: string
          vip_status?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          hotel_id?: string | null
          id?: string
          id_document_number?: string | null
          id_document_type?: string | null
          last_name?: string
          nationality?: string | null
          notes?: string | null
          organization_slug?: string | null
          phone?: string | null
          postal_code?: string | null
          preferences?: Json | null
          szallas_registration_number?: string | null
          tax_id?: string | null
          updated_at?: string
          vip_status?: string | null
        }
        Relationships: []
      }
      hotel_autoassign_profiles: {
        Row: {
          checkout_distribution_weight: number
          checkout_first: boolean
          created_at: string
          daily_count_weight: number
          floor_grouping_weight: number
          hotel_id: string
          id: string
          learned_hints: Json
          max_rooms_per_hk: number | null
          organization_slug: string | null
          room_size_weight: number
          rtc_priority_weight: number
          updated_at: string
        }
        Insert: {
          checkout_distribution_weight?: number
          checkout_first?: boolean
          created_at?: string
          daily_count_weight?: number
          floor_grouping_weight?: number
          hotel_id: string
          id?: string
          learned_hints?: Json
          max_rooms_per_hk?: number | null
          organization_slug?: string | null
          room_size_weight?: number
          rtc_priority_weight?: number
          updated_at?: string
        }
        Update: {
          checkout_distribution_weight?: number
          checkout_first?: boolean
          created_at?: string
          daily_count_weight?: number
          floor_grouping_weight?: number
          hotel_id?: string
          id?: string
          learned_hints?: Json
          max_rooms_per_hk?: number | null
          organization_slug?: string | null
          room_size_weight?: number
          rtc_priority_weight?: number
          updated_at?: string
        }
        Relationships: []
      }
      hotel_breakfast_codes: {
        Row: {
          code: string
          created_at: string
          hotel_id: string
          is_active: boolean
          organization_slug: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          hotel_id: string
          is_active?: boolean
          organization_slug: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          hotel_id?: string
          is_active?: boolean
          organization_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      hotel_configurations: {
        Row: {
          breakfast_enabled: boolean
          breakfast_restaurants: Json
          created_at: string | null
          custom_app_name: string | null
          custom_branding_enabled: boolean | null
          custom_favicon_url: string | null
          custom_login_background: string | null
          custom_logo_url: string | null
          custom_primary_color: string | null
          custom_secondary_color: string | null
          custom_welcome_message: string | null
          hotel_id: string
          hotel_name: string
          id: string
          is_active: boolean | null
          logo_scale: number | null
          logo_scale_auth: number | null
          minibar_logo_url: string | null
          organization_id: string | null
          settings: Json | null
          updated_at: string | null
        }
        Insert: {
          breakfast_enabled?: boolean
          breakfast_restaurants?: Json
          created_at?: string | null
          custom_app_name?: string | null
          custom_branding_enabled?: boolean | null
          custom_favicon_url?: string | null
          custom_login_background?: string | null
          custom_logo_url?: string | null
          custom_primary_color?: string | null
          custom_secondary_color?: string | null
          custom_welcome_message?: string | null
          hotel_id: string
          hotel_name: string
          id?: string
          is_active?: boolean | null
          logo_scale?: number | null
          logo_scale_auth?: number | null
          minibar_logo_url?: string | null
          organization_id?: string | null
          settings?: Json | null
          updated_at?: string | null
        }
        Update: {
          breakfast_enabled?: boolean
          breakfast_restaurants?: Json
          created_at?: string | null
          custom_app_name?: string | null
          custom_branding_enabled?: boolean | null
          custom_favicon_url?: string | null
          custom_login_background?: string | null
          custom_logo_url?: string | null
          custom_primary_color?: string | null
          custom_secondary_color?: string | null
          custom_welcome_message?: string | null
          hotel_id?: string
          hotel_name?: string
          id?: string
          is_active?: boolean | null
          logo_scale?: number | null
          logo_scale_auth?: number | null
          minibar_logo_url?: string | null
          organization_id?: string | null
          settings?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hotel_data_sources: {
        Row: {
          auth_headers: Json | null
          created_at: string
          hotel_id: string
          id: string
          is_active: boolean
          kind: string
          last_run_at: string | null
          last_status: string | null
          name: string
          organization_slug: string
          schedule_cron: string | null
          transport: string
          url: string | null
        }
        Insert: {
          auth_headers?: Json | null
          created_at?: string
          hotel_id: string
          id?: string
          is_active?: boolean
          kind: string
          last_run_at?: string | null
          last_status?: string | null
          name: string
          organization_slug: string
          schedule_cron?: string | null
          transport: string
          url?: string | null
        }
        Update: {
          auth_headers?: Json | null
          created_at?: string
          hotel_id?: string
          id?: string
          is_active?: boolean
          kind?: string
          last_run_at?: string | null
          last_status?: string | null
          name?: string
          organization_slug?: string
          schedule_cron?: string | null
          transport?: string
          url?: string | null
        }
        Relationships: []
      }
      hotel_events: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          end_date: string | null
          event_date: string
          hotel_id: string
          id: string
          impact: string
          notes: string | null
          organization_slug: string
          title: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          event_date: string
          hotel_id: string
          id?: string
          impact?: string
          notes?: string | null
          organization_slug: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          event_date?: string
          hotel_id?: string
          id?: string
          impact?: string
          notes?: string | null
          organization_slug?: string
          title?: string
        }
        Relationships: []
      }
      hotel_floor_layouts: {
        Row: {
          floor_number: number
          hotel_name: string
          id: string
          rotation: number
          updated_at: string
          updated_by: string | null
          wing: string
          x: number
          y: number
        }
        Insert: {
          floor_number: number
          hotel_name: string
          id?: string
          rotation?: number
          updated_at?: string
          updated_by?: string | null
          wing: string
          x?: number
          y?: number
        }
        Update: {
          floor_number?: number
          hotel_name?: string
          id?: string
          rotation?: number
          updated_at?: string
          updated_by?: string | null
          wing?: string
          x?: number
          y?: number
        }
        Relationships: []
      }
      hotel_revenue_settings: {
        Row: {
          abnormal_pickup_threshold: number
          auto_apply: boolean
          auto_push_to_pms: boolean
          autopilot_enabled: boolean
          base_currency: string
          created_at: string
          decay_window_days: number
          decrease_interval_hours: number
          engine_uses_room_setup: boolean
          eur_conversion_rate: number | null
          eur_rate_source: string | null
          eur_rate_updated_at: string | null
          extra_guest_supplement_eur: number
          floor_price_eur: number
          hotel_id: string
          idle_decay_eur: number
          idle_decay_hours: number
          is_engine_enabled: boolean
          keep_day_shape: boolean
          low_demand_decrease_eur: number
          market_city: string | null
          market_country: string | null
          max_daily_change_eur: number
          min_adr: number | null
          notify_email: string[]
          notify_on: Json
          notify_sms: string[]
          occupancy_high_pct: number
          occupancy_low_pct: number
          organization_slug: string
          pickup_burst_minutes: number
          pickup_increase_tiers: Json
          pickup_step_1_eur: number
          pickup_step_2_eur: number
          pickup_step_3_eur: number
          pickup_strong_threshold: number
          promo_budget: number | null
          rate_alert_emails_enabled: boolean
          rate_critical_below_eur: number
          rate_max_sane_eur: number
          rate_warn_below_eur: number
          rate_write_method: string | null
          rate_write_verified_at: string | null
          sellable_rooms: number | null
          skip_within_days: number
          surge_increase_eur: number
          surge_threshold: number
          surge_window_minutes: number
          target_adr: number | null
          target_booking_value: number | null
          target_room_nights: number | null
          updated_at: string
          weekday_decrease_eur: number
          weekend_decrease_eur: number
        }
        Insert: {
          abnormal_pickup_threshold?: number
          auto_apply?: boolean
          auto_push_to_pms?: boolean
          autopilot_enabled?: boolean
          base_currency?: string
          created_at?: string
          decay_window_days?: number
          decrease_interval_hours?: number
          engine_uses_room_setup?: boolean
          eur_conversion_rate?: number | null
          eur_rate_source?: string | null
          eur_rate_updated_at?: string | null
          extra_guest_supplement_eur?: number
          floor_price_eur?: number
          hotel_id: string
          idle_decay_eur?: number
          idle_decay_hours?: number
          is_engine_enabled?: boolean
          keep_day_shape?: boolean
          low_demand_decrease_eur?: number
          market_city?: string | null
          market_country?: string | null
          max_daily_change_eur?: number
          min_adr?: number | null
          notify_email?: string[]
          notify_on?: Json
          notify_sms?: string[]
          occupancy_high_pct?: number
          occupancy_low_pct?: number
          organization_slug: string
          pickup_burst_minutes?: number
          pickup_increase_tiers?: Json
          pickup_step_1_eur?: number
          pickup_step_2_eur?: number
          pickup_step_3_eur?: number
          pickup_strong_threshold?: number
          promo_budget?: number | null
          rate_alert_emails_enabled?: boolean
          rate_critical_below_eur?: number
          rate_max_sane_eur?: number
          rate_warn_below_eur?: number
          rate_write_method?: string | null
          rate_write_verified_at?: string | null
          sellable_rooms?: number | null
          skip_within_days?: number
          surge_increase_eur?: number
          surge_threshold?: number
          surge_window_minutes?: number
          target_adr?: number | null
          target_booking_value?: number | null
          target_room_nights?: number | null
          updated_at?: string
          weekday_decrease_eur?: number
          weekend_decrease_eur?: number
        }
        Update: {
          abnormal_pickup_threshold?: number
          auto_apply?: boolean
          auto_push_to_pms?: boolean
          autopilot_enabled?: boolean
          base_currency?: string
          created_at?: string
          decay_window_days?: number
          decrease_interval_hours?: number
          engine_uses_room_setup?: boolean
          eur_conversion_rate?: number | null
          eur_rate_source?: string | null
          eur_rate_updated_at?: string | null
          extra_guest_supplement_eur?: number
          floor_price_eur?: number
          hotel_id?: string
          idle_decay_eur?: number
          idle_decay_hours?: number
          is_engine_enabled?: boolean
          keep_day_shape?: boolean
          low_demand_decrease_eur?: number
          market_city?: string | null
          market_country?: string | null
          max_daily_change_eur?: number
          min_adr?: number | null
          notify_email?: string[]
          notify_on?: Json
          notify_sms?: string[]
          occupancy_high_pct?: number
          occupancy_low_pct?: number
          organization_slug?: string
          pickup_burst_minutes?: number
          pickup_increase_tiers?: Json
          pickup_step_1_eur?: number
          pickup_step_2_eur?: number
          pickup_step_3_eur?: number
          pickup_strong_threshold?: number
          promo_budget?: number | null
          rate_alert_emails_enabled?: boolean
          rate_critical_below_eur?: number
          rate_max_sane_eur?: number
          rate_warn_below_eur?: number
          rate_write_method?: string | null
          rate_write_verified_at?: string | null
          sellable_rooms?: number | null
          skip_within_days?: number
          surge_increase_eur?: number
          surge_threshold?: number
          surge_window_minutes?: number
          target_adr?: number | null
          target_booking_value?: number | null
          target_room_nights?: number | null
          updated_at?: string
          weekday_decrease_eur?: number
          weekend_decrease_eur?: number
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
      housekeeper_ratings: {
        Row: {
          assignment_id: string | null
          created_at: string
          housekeeper_id: string
          id: string
          notes: string | null
          organization_slug: string | null
          rated_by: string
          rating: number
          rating_date: string
          updated_at: string
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          housekeeper_id: string
          id?: string
          notes?: string | null
          organization_slug?: string | null
          rated_by: string
          rating: number
          rating_date?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          housekeeper_id?: string
          id?: string
          notes?: string | null
          organization_slug?: string | null
          rated_by?: string
          rating?: number
          rating_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "housekeeper_ratings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "room_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housekeeper_ratings_housekeeper_id_fkey"
            columns: ["housekeeper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housekeeper_ratings_rated_by_fkey"
            columns: ["rated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      housekeeper_username_sequence: {
        Row: {
          last_sequence_number: number
          organization_slug: string
          updated_at: string
        }
        Insert: {
          last_sequence_number?: number
          organization_slug: string
          updated_at?: string
        }
        Update: {
          last_sequence_number?: number
          organization_slug?: string
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
          organization_slug: string | null
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
          organization_slug?: string | null
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
          organization_slug?: string | null
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
          organization_slug: string | null
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
          organization_slug?: string | null
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
          organization_slug?: string | null
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
      invoice_buyer_companies: {
        Row: {
          created_at: string
          display_color: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          name: string
          normalized_tax_id: string | null
          notes: string | null
          organization_slug: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_color?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name: string
          normalized_tax_id?: string | null
          notes?: string | null
          organization_slug: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_color?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name?: string
          normalized_tax_id?: string | null
          notes?: string | null
          organization_slug?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invoice_company_aliases: {
        Row: {
          alias_name: string
          company_id: string
          created_at: string
          id: string
          organization_slug: string
        }
        Insert: {
          alias_name: string
          company_id: string
          created_at?: string
          id?: string
          organization_slug: string
        }
        Update: {
          alias_name?: string
          company_id?: string
          created_at?: string
          id?: string
          organization_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_company_aliases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "invoice_buyer_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_company_properties: {
        Row: {
          company_id: string
          created_at: string
          hotel_id: string
          id: string
          organization_slug: string
        }
        Insert: {
          company_id: string
          created_at?: string
          hotel_id: string
          id?: string
          organization_slug: string
        }
        Update: {
          company_id?: string
          created_at?: string
          hotel_id?: string
          id?: string
          organization_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_company_properties_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "invoice_buyer_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_cost_centres: {
        Row: {
          code: string
          created_at: string
          hotel_id: string | null
          id: string
          is_active: boolean
          label: string
          organization_slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          hotel_id?: string | null
          id?: string
          is_active?: boolean
          label: string
          organization_slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          hotel_id?: string | null
          id?: string
          is_active?: boolean
          label?: string
          organization_slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      lead_time_adjustments: {
        Row: {
          bucket: string
          hotel_id: string
          organization_slug: string
          percent: number
          updated_at: string
        }
        Insert: {
          bucket: string
          hotel_id: string
          organization_slug: string
          percent?: number
          updated_at?: string
        }
        Update: {
          bucket?: string
          hotel_id?: string
          organization_slug?: string
          percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      lost_and_found: {
        Row: {
          assignment_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          found_date: string
          id: string
          item_description: string
          notes: string | null
          organization_slug: string | null
          photo_urls: string[] | null
          reported_by: string
          room_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assignment_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          found_date?: string
          id?: string
          item_description: string
          notes?: string | null
          organization_slug?: string | null
          photo_urls?: string[] | null
          reported_by: string
          room_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          found_date?: string
          id?: string
          item_description?: string
          notes?: string | null
          organization_slug?: string | null
          photo_urls?: string[] | null
          reported_by?: string
          room_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lost_and_found_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "room_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lost_and_found_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_issues: {
        Row: {
          assignment_id: string | null
          created_at: string
          id: string
          issue_description: string
          notes: string | null
          organization_slug: string | null
          photo_urls: string[] | null
          priority: string
          reported_by: string
          resolution_text: string | null
          resolved_at: string | null
          resolved_by: string | null
          room_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          id?: string
          issue_description: string
          notes?: string | null
          organization_slug?: string | null
          photo_urls?: string[] | null
          priority?: string
          reported_by: string
          resolution_text?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          id?: string
          issue_description?: string
          notes?: string | null
          organization_slug?: string | null
          photo_urls?: string[] | null
          priority?: string
          reported_by?: string
          resolution_text?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_issues_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "room_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_issues_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      market_events: {
        Row: {
          category: string | null
          city: string
          confidence: number | null
          created_at: string
          end_date: string | null
          event_date: string
          expected_impact: string | null
          id: string
          source: string | null
          title: string
          url: string | null
          venue: string | null
        }
        Insert: {
          category?: string | null
          city?: string
          confidence?: number | null
          created_at?: string
          end_date?: string | null
          event_date: string
          expected_impact?: string | null
          id?: string
          source?: string | null
          title: string
          url?: string | null
          venue?: string | null
        }
        Update: {
          category?: string | null
          city?: string
          confidence?: number | null
          created_at?: string
          end_date?: string | null
          event_date?: string
          expected_impact?: string | null
          id?: string
          source?: string | null
          title?: string
          url?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      min_stay_rules: {
        Row: {
          hotel_id: string
          id: string
          min_nights: number
          notes: string | null
          organization_slug: string
          stay_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          hotel_id: string
          id?: string
          min_nights?: number
          notes?: string | null
          organization_slug: string
          stay_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          hotel_id?: string
          id?: string
          min_nights?: number
          notes?: string | null
          organization_slug?: string
          stay_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      min_stay_settings: {
        Row: {
          allow_override_fixed: boolean
          hotel_id: string
          min_floor: number
          organization_slug: string
          room_type_ids: string[]
          updated_at: string
        }
        Insert: {
          allow_override_fixed?: boolean
          hotel_id: string
          min_floor?: number
          organization_slug: string
          room_type_ids?: string[]
          updated_at?: string
        }
        Update: {
          allow_override_fixed?: boolean
          hotel_id?: string
          min_floor?: number
          organization_slug?: string
          room_type_ids?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      minibar_category_order: {
        Row: {
          category: string
          created_at: string | null
          id: string
          sort_order: number | null
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          sort_order?: number | null
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      minibar_items: {
        Row: {
          category: string | null
          created_at: string
          display_order: number | null
          expiry_days: number | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_promoted: boolean | null
          name: string
          price: number
          translations: Json | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          display_order?: number | null
          expiry_days?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_promoted?: boolean | null
          name: string
          price?: number
          translations?: Json | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          display_order?: number | null
          expiry_days?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_promoted?: boolean | null
          name?: string
          price?: number
          translations?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      minibar_placements: {
        Row: {
          collected_at: string | null
          collected_by: string | null
          created_at: string
          expires_at: string
          hotel: string
          id: string
          minibar_item_id: string
          organization_slug: string | null
          placed_at: string
          placed_by: string
          quantity: number
          room_id: string
          status: string
          updated_at: string
        }
        Insert: {
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          expires_at: string
          hotel: string
          id?: string
          minibar_item_id: string
          organization_slug?: string | null
          placed_at?: string
          placed_by: string
          quantity?: number
          room_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          expires_at?: string
          hotel?: string
          id?: string
          minibar_item_id?: string
          organization_slug?: string | null
          placed_at?: string
          placed_by?: string
          quantity?: number
          room_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "minibar_placements_minibar_item_id_fkey"
            columns: ["minibar_item_id"]
            isOneToOne: false
            referencedRelation: "minibar_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minibar_placements_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      module_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          currency: string
          current_period_end: string | null
          hotel_id: string
          id: string
          module: string
          organization_slug: string
          quantity: number
          status: string
          stripe_customer_id: string | null
          stripe_item_id: string | null
          stripe_subscription_id: string | null
          unit_amount_cents: number
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string
          current_period_end?: string | null
          hotel_id: string
          id?: string
          module: string
          organization_slug: string
          quantity?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_item_id?: string | null
          stripe_subscription_id?: string | null
          unit_amount_cents?: number
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string
          current_period_end?: string | null
          hotel_id?: string
          id?: string
          module?: string
          organization_slug?: string
          quantity?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_item_id?: string | null
          stripe_subscription_id?: string | null
          unit_amount_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      monthly_adjustments: {
        Row: {
          hotel_id: string
          month: number
          organization_slug: string
          percent: number
          updated_at: string
        }
        Insert: {
          hotel_id: string
          month: number
          organization_slug: string
          percent?: number
          updated_at?: string
        }
        Update: {
          hotel_id?: string
          month?: number
          organization_slug?: string
          percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      motivational_quote_state: {
        Row: {
          id: boolean
          last_error: string | null
          last_refresh_at: string | null
          lease_until: string | null
          paused_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          last_error?: string | null
          last_refresh_at?: string | null
          lease_until?: string | null
          paused_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          last_error?: string | null
          last_refresh_at?: string | null
          lease_until?: string | null
          paused_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      motivational_quotes: {
        Row: {
          author: string
          created_at: string
          id: string
          is_active: boolean
          quote: string
          quote_key: string | null
          source: string
        }
        Insert: {
          author?: string
          created_at?: string
          id?: string
          is_active?: boolean
          quote: string
          quote_key?: string | null
          source?: string
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          is_active?: boolean
          quote?: string
          quote_key?: string | null
          source?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          banner_permanently_hidden: boolean | null
          browser_notifications_enabled: boolean | null
          created_at: string
          id: string
          sound_notifications_enabled: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          banner_permanently_hidden?: boolean | null
          browser_notifications_enabled?: boolean | null
          created_at?: string
          id?: string
          sound_notifications_enabled?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          banner_permanently_hidden?: boolean | null
          browser_notifications_enabled?: boolean | null
          created_at?: string
          id?: string
          sound_notifications_enabled?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      occupancy_snapshots: {
        Row: {
          captured_at: string
          hotel_id: string
          id: string
          occupancy_pct: number | null
          organization_slug: string
          rooms_sold: number | null
          snapshot_label: string | null
          source: string | null
          stay_date: string
          uploaded_by: string | null
        }
        Insert: {
          captured_at?: string
          hotel_id: string
          id?: string
          occupancy_pct?: number | null
          organization_slug: string
          rooms_sold?: number | null
          snapshot_label?: string | null
          source?: string | null
          stay_date: string
          uploaded_by?: string | null
        }
        Update: {
          captured_at?: string
          hotel_id?: string
          id?: string
          occupancy_pct?: number | null
          organization_slug?: string
          rooms_sold?: number | null
          snapshot_label?: string | null
          source?: string | null
          stay_date?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      occupancy_strategy: {
        Row: {
          aggressiveness: string
          close_out_last_day_pct: number
          hotel_id: string
          median_booking_window: number
          organization_slug: string
          shoulder_discount_pct: number
          updated_at: string
        }
        Insert: {
          aggressiveness?: string
          close_out_last_day_pct?: number
          hotel_id: string
          median_booking_window?: number
          organization_slug: string
          shoulder_discount_pct?: number
          updated_at?: string
        }
        Update: {
          aggressiveness?: string
          close_out_last_day_pct?: number
          hotel_id?: string
          median_booking_window?: number
          organization_slug?: string
          shoulder_discount_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      occupancy_targets: {
        Row: {
          hotel_id: string
          month: number
          organization_slug: string
          target_pct: number
          updated_at: string
        }
        Insert: {
          hotel_id: string
          month: number
          organization_slug: string
          target_pct?: number
          updated_at?: string
        }
        Update: {
          hotel_id?: string
          month?: number
          organization_slug?: string
          target_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      organization_settings: {
        Row: {
          id: string
          organization_slug: string
          setting_key: string
          setting_value: Json
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          organization_slug: string
          setting_key: string
          setting_value: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          organization_slug?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      organizations: {
        Row: {
          allow_custom_branding: boolean | null
          created_at: string | null
          custom_app_name: string | null
          custom_favicon_url: string | null
          custom_login_background: string | null
          custom_logo_url: string | null
          custom_primary_color: string | null
          custom_secondary_color: string | null
          custom_welcome_message: string | null
          id: string
          is_active: boolean | null
          logo_scale: number | null
          name: string
          settings: Json | null
          slug: string
          subscription_tier: string | null
          updated_at: string | null
        }
        Insert: {
          allow_custom_branding?: boolean | null
          created_at?: string | null
          custom_app_name?: string | null
          custom_favicon_url?: string | null
          custom_login_background?: string | null
          custom_logo_url?: string | null
          custom_primary_color?: string | null
          custom_secondary_color?: string | null
          custom_welcome_message?: string | null
          id?: string
          is_active?: boolean | null
          logo_scale?: number | null
          name: string
          settings?: Json | null
          slug: string
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Update: {
          allow_custom_branding?: boolean | null
          created_at?: string | null
          custom_app_name?: string | null
          custom_favicon_url?: string | null
          custom_login_background?: string | null
          custom_logo_url?: string | null
          custom_primary_color?: string | null
          custom_secondary_color?: string | null
          custom_welcome_message?: string | null
          id?: string
          is_active?: boolean | null
          logo_scale?: number | null
          name?: string
          settings?: Json | null
          slug?: string
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      password_reset_otps: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          otp_code: string
          phone_number: string | null
          used: boolean | null
          verified: boolean | null
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          otp_code: string
          phone_number?: string | null
          used?: boolean | null
          verified?: boolean | null
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          otp_code?: string
          phone_number?: string | null
          used?: boolean | null
          verified?: boolean | null
        }
        Relationships: []
      }
      photo_cleanup_log: {
        Row: {
          cleanup_date: string
          created_at: string
          deleted_completion_photos: number | null
          deleted_dnd_photos: number | null
          deleted_storage_files: number | null
          errors: Json | null
          id: string
          initiated_by: string | null
          status: string
          storage_freed_mb: number | null
        }
        Insert: {
          cleanup_date?: string
          created_at?: string
          deleted_completion_photos?: number | null
          deleted_dnd_photos?: number | null
          deleted_storage_files?: number | null
          errors?: Json | null
          id?: string
          initiated_by?: string | null
          status?: string
          storage_freed_mb?: number | null
        }
        Update: {
          cleanup_date?: string
          created_at?: string
          deleted_completion_photos?: number | null
          deleted_dnd_photos?: number | null
          deleted_storage_files?: number | null
          errors?: Json | null
          id?: string
          initiated_by?: string | null
          status?: string
          storage_freed_mb?: number | null
        }
        Relationships: []
      }
      pickup_snapshots: {
        Row: {
          bookings_current: number
          bookings_last_year: number
          captured_at: string
          delta: number
          hotel_id: string
          id: string
          organization_slug: string
          snapshot_label: string | null
          source: string
          stay_date: string
          uploaded_by: string | null
        }
        Insert: {
          bookings_current?: number
          bookings_last_year?: number
          captured_at?: string
          delta?: number
          hotel_id: string
          id?: string
          organization_slug: string
          snapshot_label?: string | null
          source?: string
          stay_date: string
          uploaded_by?: string | null
        }
        Update: {
          bookings_current?: number
          bookings_last_year?: number
          captured_at?: string
          delta?: number
          hotel_id?: string
          id?: string
          organization_slug?: string
          snapshot_label?: string | null
          source?: string
          stay_date?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_snapshots_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_accounts: {
        Row: {
          api_base_url: string | null
          auto_sync_enabled: boolean
          consecutive_failures: number
          created_at: string
          credentials_secret_name: string | null
          hotel_id: string
          id: string
          is_active: boolean
          is_primary: boolean
          label: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_sync_success_at: string | null
          organization_slug: string
          outbound_kill_switch: boolean
          pms_hotel_id: string | null
          pms_type: string
          settings: Json
          status_push_enabled: boolean
          sync_paused: boolean
          updated_at: string
        }
        Insert: {
          api_base_url?: string | null
          auto_sync_enabled?: boolean
          consecutive_failures?: number
          created_at?: string
          credentials_secret_name?: string | null
          hotel_id: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_sync_success_at?: string | null
          organization_slug: string
          outbound_kill_switch?: boolean
          pms_hotel_id?: string | null
          pms_type?: string
          settings?: Json
          status_push_enabled?: boolean
          sync_paused?: boolean
          updated_at?: string
        }
        Update: {
          api_base_url?: string | null
          auto_sync_enabled?: boolean
          consecutive_failures?: number
          created_at?: string
          credentials_secret_name?: string | null
          hotel_id?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_sync_success_at?: string | null
          organization_slug?: string
          outbound_kill_switch?: boolean
          pms_hotel_id?: string | null
          pms_type?: string
          settings?: Json
          status_push_enabled?: boolean
          sync_paused?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      pms_change_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          after: Json | null
          auto_applied: boolean
          before: Json | null
          category: string | null
          change_kind: string | null
          conflicts_with_assignment_id: string | null
          detected_at: string
          event_type: string
          hotel_id: string
          id: string
          is_conflict: boolean
          notes: string | null
          previo_reservation_id: string | null
          resolution: string | null
          room_id: string | null
          room_label: string | null
          source: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          after?: Json | null
          auto_applied?: boolean
          before?: Json | null
          category?: string | null
          change_kind?: string | null
          conflicts_with_assignment_id?: string | null
          detected_at?: string
          event_type: string
          hotel_id: string
          id?: string
          is_conflict?: boolean
          notes?: string | null
          previo_reservation_id?: string | null
          resolution?: string | null
          room_id?: string | null
          room_label?: string | null
          source?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          after?: Json | null
          auto_applied?: boolean
          before?: Json | null
          category?: string | null
          change_kind?: string | null
          conflicts_with_assignment_id?: string | null
          detected_at?: string
          event_type?: string
          hotel_id?: string
          id?: string
          is_conflict?: boolean
          notes?: string | null
          previo_reservation_id?: string | null
          resolution?: string | null
          room_id?: string | null
          room_label?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_change_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_configurations: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          api_auth_type: string | null
          api_base_url: string | null
          auto_sync_enabled: boolean
          checkout_poll_enabled: boolean
          connection_mode: string
          connection_test_enabled: boolean
          consecutive_sync_failures: number
          created_at: string
          credentials_secret_name: string | null
          environment: string
          hide_pms_upload_page: boolean
          hotel_id: string
          id: string
          is_active: boolean
          last_connection_test_at: string | null
          last_connection_test_error: string | null
          last_connection_test_status: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_sync_success_at: string | null
          last_test_at: string | null
          last_test_error: string | null
          last_test_status: string | null
          nightly_sync_enabled: boolean
          outbound_kill_switch: boolean
          outbound_room_allowlist: string[] | null
          pms_hotel_id: string
          pms_type: string
          room_discovery_enabled: boolean
          room_import_enabled: boolean
          settings: Json | null
          snapshot_read_enabled: boolean
          snapshot_shadow_mode: boolean
          status_push_enabled: boolean
          sync_enabled: boolean
          sync_mode: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          api_auth_type?: string | null
          api_base_url?: string | null
          auto_sync_enabled?: boolean
          checkout_poll_enabled?: boolean
          connection_mode?: string
          connection_test_enabled?: boolean
          consecutive_sync_failures?: number
          created_at?: string
          credentials_secret_name?: string | null
          environment?: string
          hide_pms_upload_page?: boolean
          hotel_id: string
          id?: string
          is_active?: boolean
          last_connection_test_at?: string | null
          last_connection_test_error?: string | null
          last_connection_test_status?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_sync_success_at?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          nightly_sync_enabled?: boolean
          outbound_kill_switch?: boolean
          outbound_room_allowlist?: string[] | null
          pms_hotel_id: string
          pms_type?: string
          room_discovery_enabled?: boolean
          room_import_enabled?: boolean
          settings?: Json | null
          snapshot_read_enabled?: boolean
          snapshot_shadow_mode?: boolean
          status_push_enabled?: boolean
          sync_enabled?: boolean
          sync_mode?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          api_auth_type?: string | null
          api_base_url?: string | null
          auto_sync_enabled?: boolean
          checkout_poll_enabled?: boolean
          connection_mode?: string
          connection_test_enabled?: boolean
          consecutive_sync_failures?: number
          created_at?: string
          credentials_secret_name?: string | null
          environment?: string
          hide_pms_upload_page?: boolean
          hotel_id?: string
          id?: string
          is_active?: boolean
          last_connection_test_at?: string | null
          last_connection_test_error?: string | null
          last_connection_test_status?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_sync_success_at?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_status?: string | null
          nightly_sync_enabled?: boolean
          outbound_kill_switch?: boolean
          outbound_room_allowlist?: string[] | null
          pms_hotel_id?: string
          pms_type?: string
          room_discovery_enabled?: boolean
          room_import_enabled?: boolean
          settings?: Json | null
          snapshot_read_enabled?: boolean
          snapshot_shadow_mode?: boolean
          status_push_enabled?: boolean
          sync_enabled?: boolean
          sync_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_configurations_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotel_configurations"
            referencedColumns: ["hotel_id"]
          },
        ]
      }
      pms_outbound_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          hotel_id: string
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json | null
          previo_room_id: string | null
          room_id: string
          source_assignment_id: string | null
          status: string
          target_status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          hotel_id: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json | null
          previo_room_id?: string | null
          room_id: string
          source_assignment_id?: string | null
          status?: string
          target_status: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          hotel_id?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json | null
          previo_room_id?: string | null
          room_id?: string
          source_assignment_id?: string | null
          status?: string
          target_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_outbound_queue_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pms_outbound_queue_source_assignment_id_fkey"
            columns: ["source_assignment_id"]
            isOneToOne: false
            referencedRelation: "room_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_rate_plan_mappings: {
        Row: {
          channel: string
          created_at: string
          hotel_id: string
          id: string
          is_active: boolean
          organization_slug: string
          pms_rate_plan_id: string
          room_type_id: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          hotel_id: string
          id?: string
          is_active?: boolean
          organization_slug: string
          pms_rate_plan_id: string
          room_type_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          hotel_id?: string
          id?: string
          is_active?: boolean
          organization_slug?: string
          pms_rate_plan_id?: string
          room_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pms_rate_plan_mappings_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_room_mappings: {
        Row: {
          confidence: number | null
          created_at: string
          hotelcare_room_id: string | null
          hotelcare_room_number: string
          id: string
          is_active: boolean
          last_verified_at: string | null
          mapping_status: string
          notes: string | null
          pms_config_id: string
          pms_room_id: string
          pms_room_name: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          hotelcare_room_id?: string | null
          hotelcare_room_number: string
          id?: string
          is_active?: boolean
          last_verified_at?: string | null
          mapping_status?: string
          notes?: string | null
          pms_config_id: string
          pms_room_id: string
          pms_room_name?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          hotelcare_room_id?: string | null
          hotelcare_room_number?: string
          id?: string
          is_active?: boolean
          last_verified_at?: string | null
          mapping_status?: string
          notes?: string | null
          pms_config_id?: string
          pms_room_id?: string
          pms_room_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_room_mappings_hotelcare_room_id_fkey"
            columns: ["hotelcare_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pms_room_mappings_pms_config_id_fkey"
            columns: ["pms_config_id"]
            isOneToOne: false
            referencedRelation: "pms_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_snapshots: {
        Row: {
          business_date: string
          content_hash: string
          created_at: string
          created_by: string | null
          hotel_id: string
          id: string
          rooms: Json
          source: string
        }
        Insert: {
          business_date: string
          content_hash: string
          created_at?: string
          created_by?: string | null
          hotel_id: string
          id?: string
          rooms: Json
          source: string
        }
        Update: {
          business_date?: string
          content_hash?: string
          created_at?: string
          created_by?: string | null
          hotel_id?: string
          id?: string
          rooms?: Json
          source?: string
        }
        Relationships: []
      }
      pms_sync_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          created_at: string | null
          data: Json | null
          direction: string
          error_message: string | null
          hotel_id: string | null
          id: string
          sync_status: string
          sync_type: string
          synced_by_name: string | null
          synced_by_user_id: string | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          created_at?: string | null
          data?: Json | null
          direction: string
          error_message?: string | null
          hotel_id?: string | null
          id?: string
          sync_status: string
          sync_type: string
          synced_by_name?: string | null
          synced_by_user_id?: string | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          created_at?: string | null
          data?: Json | null
          direction?: string
          error_message?: string | null
          hotel_id?: string | null
          id?: string
          sync_status?: string
          sync_type?: string
          synced_by_name?: string | null
          synced_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pms_sync_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_unit_mappings: {
        Row: {
          canonical_room_name: string | null
          confidence: number
          conflict_reason: string | null
          created_at: string
          external_room_id: string | null
          external_type_id: string | null
          hotel_id: string
          id: string
          metadata: Json
          normalized_name: string
          organization_slug: string
          pms_account_id: string | null
          pms_hotel_id: string | null
          review_notes: string | null
          room_id: string | null
          source_date: string | null
          source_file: string | null
          source_kind: string
          source_name: string
          status: string
          suggested_venue_name: string | null
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          canonical_room_name?: string | null
          confidence?: number
          conflict_reason?: string | null
          created_at?: string
          external_room_id?: string | null
          external_type_id?: string | null
          hotel_id: string
          id?: string
          metadata?: Json
          normalized_name: string
          organization_slug: string
          pms_account_id?: string | null
          pms_hotel_id?: string | null
          review_notes?: string | null
          room_id?: string | null
          source_date?: string | null
          source_file?: string | null
          source_kind?: string
          source_name: string
          status?: string
          suggested_venue_name?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          canonical_room_name?: string | null
          confidence?: number
          conflict_reason?: string | null
          created_at?: string
          external_room_id?: string | null
          external_type_id?: string | null
          hotel_id?: string
          id?: string
          metadata?: Json
          normalized_name?: string
          organization_slug?: string
          pms_account_id?: string | null
          pms_hotel_id?: string | null
          review_notes?: string | null
          room_id?: string | null
          source_date?: string | null
          source_file?: string | null
          source_kind?: string
          source_name?: string
          status?: string
          suggested_venue_name?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pms_unit_mappings_pms_account_id_fkey"
            columns: ["pms_account_id"]
            isOneToOne: false
            referencedRelation: "pms_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pms_unit_mappings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pms_unit_mappings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_upload_summary: {
        Row: {
          assigned_rooms: number | null
          checkout_rooms: Json | null
          created_at: string | null
          daily_cleaning_rooms: Json | null
          errors: Json | null
          hotel_filter: string | null
          id: string
          organization_slug: string | null
          processed_rooms: number | null
          updated_at: string | null
          updated_rooms: number | null
          upload_date: string | null
          uploaded_by: string
        }
        Insert: {
          assigned_rooms?: number | null
          checkout_rooms?: Json | null
          created_at?: string | null
          daily_cleaning_rooms?: Json | null
          errors?: Json | null
          hotel_filter?: string | null
          id?: string
          organization_slug?: string | null
          processed_rooms?: number | null
          updated_at?: string | null
          updated_rooms?: number | null
          upload_date?: string | null
          uploaded_by: string
        }
        Update: {
          assigned_rooms?: number | null
          checkout_rooms?: Json | null
          created_at?: string | null
          daily_cleaning_rooms?: Json | null
          errors?: Json | null
          hotel_filter?: string | null
          id?: string
          organization_slug?: string | null
          processed_rooms?: number | null
          updated_at?: string | null
          updated_rooms?: number | null
          upload_date?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_upload_summary_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      previo_rate_plan_mapping: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          is_default: boolean
          organization_slug: string
          previo_rate_plan_id: string | null
          previo_room_type_id: string | null
          room_type_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          is_default?: boolean
          organization_slug: string
          previo_rate_plan_id?: string | null
          previo_room_type_id?: string | null
          room_type_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          is_default?: boolean
          organization_slug?: string
          previo_rate_plan_id?: string | null
          previo_room_type_id?: string | null
          room_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "previo_rate_plan_mapping_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      previo_rate_snapshots: {
        Row: {
          availability: number | null
          hotel_id: string
          id: string
          organization_slug: string
          pulled_at: string
          rate_eur: number | null
          rate_plan_id: string
          restrictions: Json | null
          room_kind_id: string
          source: string
          stay_date: string
        }
        Insert: {
          availability?: number | null
          hotel_id: string
          id?: string
          organization_slug: string
          pulled_at?: string
          rate_eur?: number | null
          rate_plan_id: string
          restrictions?: Json | null
          room_kind_id: string
          source?: string
          stay_date: string
        }
        Update: {
          availability?: number | null
          hotel_id?: string
          id?: string
          organization_slug?: string
          pulled_at?: string
          rate_eur?: number | null
          rate_plan_id?: string
          restrictions?: Json | null
          room_kind_id?: string
          source?: string
          stay_date?: string
        }
        Relationships: []
      }
      previo_reference_prices: {
        Row: {
          captured_at: string
          currency: string
          hotel_id: string
          organization_slug: string
          persons: number | null
          pricelist_id: string | null
          rate_eur: number
          stay_date: string
        }
        Insert: {
          captured_at?: string
          currency?: string
          hotel_id: string
          organization_slug: string
          persons?: number | null
          pricelist_id?: string | null
          rate_eur: number
          stay_date: string
        }
        Update: {
          captured_at?: string
          currency?: string
          hotel_id?: string
          organization_slug?: string
          persons?: number | null
          pricelist_id?: string | null
          rate_eur?: number
          stay_date?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          acts_as_housekeeper: boolean
          assigned_hotel: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string
          full_name: string
          hotel_id: string | null
          id: string
          is_super_admin: boolean | null
          job_title: string | null
          last_login: string | null
          nickname: string | null
          organization_slug: string | null
          phone_number: string | null
          preferred_language: string | null
          profile_picture_url: string | null
          role: Database["public"]["Enums"]["user_role"]
          ui_preferences: Json
          updated_at: string | null
        }
        Insert: {
          acts_as_housekeeper?: boolean
          assigned_hotel?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email: string
          full_name: string
          hotel_id?: string | null
          id: string
          is_super_admin?: boolean | null
          job_title?: string | null
          last_login?: string | null
          nickname?: string | null
          organization_slug?: string | null
          phone_number?: string | null
          preferred_language?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          ui_preferences?: Json
          updated_at?: string | null
        }
        Update: {
          acts_as_housekeeper?: boolean
          assigned_hotel?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string
          full_name?: string
          hotel_id?: string | null
          id?: string
          is_super_admin?: boolean | null
          job_title?: string | null
          last_login?: string | null
          nickname?: string | null
          organization_slug?: string | null
          phone_number?: string | null
          preferred_language?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          ui_preferences?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      purchase_invoice_audit_log: {
        Row: {
          action: string
          created_at: string
          field: string | null
          id: string
          invoice_id: string
          new_value: string | null
          notes: string | null
          old_value: string | null
          organization_slug: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          field?: string | null
          id?: string
          invoice_id: string
          new_value?: string | null
          notes?: string | null
          old_value?: string | null
          organization_slug?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          field?: string | null
          id?: string
          invoice_id?: string
          new_value?: string | null
          notes?: string | null
          old_value?: string | null
          organization_slug?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_audit_log_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoice_categories: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          organization_slug: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          organization_slug: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          organization_slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      purchase_invoice_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          item_code: string | null
          item_type: string | null
          name_english: string | null
          name_original: string | null
          position: number
          quantity: number | null
          total_price: number | null
          unit_price: number | null
          vat_rate: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          item_code?: string | null
          item_type?: string | null
          name_english?: string | null
          name_original?: string | null
          position?: number
          quantity?: number | null
          total_price?: number | null
          unit_price?: number | null
          vat_rate?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          item_code?: string | null
          item_type?: string | null
          name_english?: string | null
          name_original?: string | null
          position?: number
          quantity?: number | null
          total_price?: number | null
          unit_price?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoice_vat_lines: {
        Row: {
          country: string | null
          created_at: string
          id: string
          invoice_id: string
          vat_amount: number
          vat_base: number
          vat_kind: string
          vat_rate: number
        }
        Insert: {
          country?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          vat_amount?: number
          vat_base?: number
          vat_kind: string
          vat_rate: number
        }
        Update: {
          country?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          vat_amount?: number
          vat_base?: number
          vat_kind?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_vat_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          bottle_deposit_amount: number | null
          buyer_address: string | null
          buyer_company_id: string | null
          buyer_name: string | null
          buyer_tax_id: string | null
          company_property_mismatch: boolean
          confidence_score: number | null
          cost_centre_id: string | null
          created_at: string
          currency: string
          document_type: string | null
          due_date: string | null
          duplicate_of: string | null
          duplicate_status: string
          error_code: string | null
          error_details: Json | null
          expense_category: string | null
          expense_category_id: string | null
          extraction_notes: string | null
          file_mime: string | null
          file_path: string
          file_sha256: string | null
          file_size_bytes: number | null
          hotel_id: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          is_credit_note: boolean
          is_verified: boolean
          merchant_address: string | null
          merchant_country: string | null
          merchant_name: string | null
          merchant_tax_id: string | null
          needs_review: boolean
          net_amount: number | null
          normalized_invoice_number: string | null
          normalized_merchant_tax_id: string | null
          notes: string | null
          organization_slug: string
          payment_method: string | null
          performance_date: string | null
          processing_notes: string | null
          raw_text: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          submitted_at: string | null
          total_amount: number | null
          total_vat_amount: number | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          bottle_deposit_amount?: number | null
          buyer_address?: string | null
          buyer_company_id?: string | null
          buyer_name?: string | null
          buyer_tax_id?: string | null
          company_property_mismatch?: boolean
          confidence_score?: number | null
          cost_centre_id?: string | null
          created_at?: string
          currency?: string
          document_type?: string | null
          due_date?: string | null
          duplicate_of?: string | null
          duplicate_status?: string
          error_code?: string | null
          error_details?: Json | null
          expense_category?: string | null
          expense_category_id?: string | null
          extraction_notes?: string | null
          file_mime?: string | null
          file_path: string
          file_sha256?: string | null
          file_size_bytes?: number | null
          hotel_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          is_credit_note?: boolean
          is_verified?: boolean
          merchant_address?: string | null
          merchant_country?: string | null
          merchant_name?: string | null
          merchant_tax_id?: string | null
          needs_review?: boolean
          net_amount?: number | null
          normalized_invoice_number?: string | null
          normalized_merchant_tax_id?: string | null
          notes?: string | null
          organization_slug: string
          payment_method?: string | null
          performance_date?: string | null
          processing_notes?: string | null
          raw_text?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          submitted_at?: string | null
          total_amount?: number | null
          total_vat_amount?: number | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          bottle_deposit_amount?: number | null
          buyer_address?: string | null
          buyer_company_id?: string | null
          buyer_name?: string | null
          buyer_tax_id?: string | null
          company_property_mismatch?: boolean
          confidence_score?: number | null
          cost_centre_id?: string | null
          created_at?: string
          currency?: string
          document_type?: string | null
          due_date?: string | null
          duplicate_of?: string | null
          duplicate_status?: string
          error_code?: string | null
          error_details?: Json | null
          expense_category?: string | null
          expense_category_id?: string | null
          extraction_notes?: string | null
          file_mime?: string | null
          file_path?: string
          file_sha256?: string | null
          file_size_bytes?: number | null
          hotel_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          is_credit_note?: boolean
          is_verified?: boolean
          merchant_address?: string | null
          merchant_country?: string | null
          merchant_name?: string | null
          merchant_tax_id?: string | null
          needs_review?: boolean
          net_amount?: number | null
          normalized_invoice_number?: string | null
          normalized_merchant_tax_id?: string | null
          notes?: string | null
          organization_slug?: string
          payment_method?: string | null
          performance_date?: string | null
          processing_notes?: string | null
          raw_text?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          submitted_at?: string | null
          total_amount?: number | null
          total_vat_amount?: number | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_buyer_company_fk"
            columns: ["buyer_company_id"]
            isOneToOne: false
            referencedRelation: "invoice_buyer_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_cost_centre_id_fkey"
            columns: ["cost_centre_id"]
            isOneToOne: false
            referencedRelation: "invoice_cost_centres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_expense_category_id_fkey"
            columns: ["expense_category_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoice_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_calendar: {
        Row: {
          available_rooms: number | null
          created_at: string
          date: string
          id: string
          is_closed: boolean | null
          min_stay_override: number | null
          rate: number
          rate_plan_id: string
        }
        Insert: {
          available_rooms?: number | null
          created_at?: string
          date: string
          id?: string
          is_closed?: boolean | null
          min_stay_override?: number | null
          rate: number
          rate_plan_id: string
        }
        Update: {
          available_rooms?: number | null
          created_at?: string
          date?: string
          id?: string
          is_closed?: boolean | null
          min_stay_override?: number | null
          rate?: number
          rate_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_calendar_rate_plan_id_fkey"
            columns: ["rate_plan_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_change_audit: {
        Row: {
          action: string
          delta_eur: number | null
          hotel_id: string
          id: string
          new_rate_eur: number | null
          notes: string | null
          old_rate_eur: number | null
          organization_slug: string
          payload: Json | null
          performed_at: string
          performed_by: string | null
          recommendation_id: string | null
          source: string | null
          stay_date: string | null
        }
        Insert: {
          action: string
          delta_eur?: number | null
          hotel_id: string
          id?: string
          new_rate_eur?: number | null
          notes?: string | null
          old_rate_eur?: number | null
          organization_slug: string
          payload?: Json | null
          performed_at?: string
          performed_by?: string | null
          recommendation_id?: string | null
          source?: string | null
          stay_date?: string | null
        }
        Update: {
          action?: string
          delta_eur?: number | null
          hotel_id?: string
          id?: string
          new_rate_eur?: number | null
          notes?: string | null
          old_rate_eur?: number | null
          organization_slug?: string
          payload?: Json | null
          performed_at?: string
          performed_by?: string | null
          recommendation_id?: string | null
          source?: string | null
          stay_date?: string | null
        }
        Relationships: []
      }
      rate_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          hotel_id: string
          id: string
          new_rate_eur: number
          notes: string | null
          old_rate_eur: number | null
          organization_slug: string
          source: Database["public"]["Enums"]["rate_change_source"]
          stay_date: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          hotel_id: string
          id?: string
          new_rate_eur: number
          notes?: string | null
          old_rate_eur?: number | null
          organization_slug: string
          source: Database["public"]["Enums"]["rate_change_source"]
          stay_date: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          hotel_id?: string
          id?: string
          new_rate_eur?: number
          notes?: string | null
          old_rate_eur?: number | null
          organization_slug?: string
          source?: Database["public"]["Enums"]["rate_change_source"]
          stay_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_plans: {
        Row: {
          base_rate: number
          cancellation_policy: string | null
          created_at: string
          currency: string | null
          hotel_id: string | null
          id: string
          is_active: boolean | null
          max_stay: number | null
          meal_plan: string | null
          min_stay: number | null
          name: string
          organization_slug: string | null
          room_type: string | null
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          base_rate?: number
          cancellation_policy?: string | null
          created_at?: string
          currency?: string | null
          hotel_id?: string | null
          id?: string
          is_active?: boolean | null
          max_stay?: number | null
          meal_plan?: string | null
          min_stay?: number | null
          name: string
          organization_slug?: string | null
          room_type?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          base_rate?: number
          cancellation_policy?: string | null
          created_at?: string
          currency?: string | null
          hotel_id?: string | null
          id?: string
          is_active?: boolean | null
          max_stay?: number | null
          meal_plan?: string | null
          min_stay?: number | null
          name?: string
          organization_slug?: string | null
          room_type?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      rate_recommendations: {
        Row: {
          auto_generated: boolean
          auto_pushed: boolean
          created_at: string
          current_rate_eur: number | null
          delta_eur: number
          hotel_id: string
          id: string
          organization_slug: string
          priority: string
          pushed_at: string | null
          reason: string | null
          recommended_rate_eur: number
          reviewed_at: string | null
          reviewed_by: string | null
          source_kind: string | null
          status: Database["public"]["Enums"]["rate_recommendation_status"]
          stay_date: string
        }
        Insert: {
          auto_generated?: boolean
          auto_pushed?: boolean
          created_at?: string
          current_rate_eur?: number | null
          delta_eur: number
          hotel_id: string
          id?: string
          organization_slug: string
          priority?: string
          pushed_at?: string | null
          reason?: string | null
          recommended_rate_eur: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_kind?: string | null
          status?: Database["public"]["Enums"]["rate_recommendation_status"]
          stay_date: string
        }
        Update: {
          auto_generated?: boolean
          auto_pushed?: boolean
          created_at?: string
          current_rate_eur?: number | null
          delta_eur?: number
          hotel_id?: string
          id?: string
          organization_slug?: string
          priority?: string
          pushed_at?: string | null
          reason?: string | null
          recommended_rate_eur?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_kind?: string | null
          status?: Database["public"]["Enums"]["rate_recommendation_status"]
          stay_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_recommendations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_room_assignments: {
        Row: {
          check_in_date: string
          check_out_date: string
          created_at: string
          id: string
          reservation_id: string
          room_id: string
          status: string | null
        }
        Insert: {
          check_in_date: string
          check_out_date: string
          created_at?: string
          id?: string
          reservation_id: string
          room_id: string
          status?: string | null
        }
        Update: {
          check_in_date?: string
          check_out_date?: string
          created_at?: string
          id?: string
          reservation_id?: string
          room_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_room_assignments_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_room_assignments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          actual_check_in: string | null
          actual_check_out: string | null
          adults: number
          balance_due: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          check_in_date: string
          check_out_date: string
          children: number
          created_at: string
          created_by: string | null
          currency: string | null
          guest_id: string | null
          hotel_id: string | null
          id: string
          internal_notes: string | null
          organization_slug: string | null
          payment_status: string | null
          rate_per_night: number | null
          reservation_number: string | null
          room_id: string | null
          room_type_requested: string | null
          source: string | null
          source_reservation_id: string | null
          special_requests: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          total_amount: number | null
          total_nights: number | null
          updated_at: string
        }
        Insert: {
          actual_check_in?: string | null
          actual_check_out?: string | null
          adults?: number
          balance_due?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          check_in_date: string
          check_out_date: string
          children?: number
          created_at?: string
          created_by?: string | null
          currency?: string | null
          guest_id?: string | null
          hotel_id?: string | null
          id?: string
          internal_notes?: string | null
          organization_slug?: string | null
          payment_status?: string | null
          rate_per_night?: number | null
          reservation_number?: string | null
          room_id?: string | null
          room_type_requested?: string | null
          source?: string | null
          source_reservation_id?: string | null
          special_requests?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          total_amount?: number | null
          total_nights?: number | null
          updated_at?: string
        }
        Update: {
          actual_check_in?: string | null
          actual_check_out?: string | null
          adults?: number
          balance_due?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          check_in_date?: string
          check_out_date?: string
          children?: number
          created_at?: string
          created_by?: string | null
          currency?: string | null
          guest_id?: string | null
          hotel_id?: string | null
          id?: string
          internal_notes?: string | null
          organization_slug?: string | null
          payment_status?: string | null
          rate_per_night?: number | null
          reservation_number?: string | null
          room_id?: string | null
          room_type_requested?: string | null
          source?: string | null
          source_reservation_id?: string | null
          special_requests?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          total_amount?: number | null
          total_nights?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_reservations: {
        Row: {
          created_at: string
          dashboard_sync_error: string | null
          dashboard_sync_state: string
          dashboard_synced_at: string | null
          ends_at: string | null
          guest_email: string | null
          guest_name: string
          guest_phone: string | null
          hotel_id: string
          id: string
          notes: string | null
          occasion: string | null
          outlet_slug: string
          party_size: number
          raw_payload: Json | null
          service_date: string
          source_project: string
          source_reservation_id: string
          special_requests: string | null
          starts_at: string
          status: string
          status_marked_at: string | null
          status_marked_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dashboard_sync_error?: string | null
          dashboard_sync_state?: string
          dashboard_synced_at?: string | null
          ends_at?: string | null
          guest_email?: string | null
          guest_name?: string
          guest_phone?: string | null
          hotel_id: string
          id?: string
          notes?: string | null
          occasion?: string | null
          outlet_slug?: string
          party_size?: number
          raw_payload?: Json | null
          service_date: string
          source_project: string
          source_reservation_id: string
          special_requests?: string | null
          starts_at: string
          status?: string
          status_marked_at?: string | null
          status_marked_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dashboard_sync_error?: string | null
          dashboard_sync_state?: string
          dashboard_synced_at?: string | null
          ends_at?: string | null
          guest_email?: string | null
          guest_name?: string
          guest_phone?: string | null
          hotel_id?: string
          id?: string
          notes?: string | null
          occasion?: string | null
          outlet_slug?: string
          party_size?: number
          raw_payload?: Json | null
          service_date?: string
          source_project?: string
          source_reservation_id?: string
          special_requests?: string | null
          starts_at?: string
          status?: string
          status_marked_at?: string | null
          status_marked_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_reservations_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_webhook_log: {
        Row: {
          created_at: string
          http_status: number
          id: string
          message: string | null
          outcome: string
          payload: Json | null
          property_slug: string | null
          source_reservation_id: string | null
        }
        Insert: {
          created_at?: string
          http_status: number
          id?: string
          message?: string | null
          outcome: string
          payload?: Json | null
          property_slug?: string | null
          source_reservation_id?: string | null
        }
        Update: {
          created_at?: string
          http_status?: number
          id?: string
          message?: string | null
          outcome?: string
          payload?: Json | null
          property_slug?: string | null
          source_reservation_id?: string | null
        }
        Relationships: []
      }
      restaurant_webhook_sources: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          is_active: boolean
          outlet_slugs: string[]
          property_slug: string
          secret_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          is_active?: boolean
          outlet_slugs?: string[]
          property_slug: string
          secret_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          is_active?: boolean
          outlet_slugs?: string[]
          property_slug?: string
          secret_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_webhook_sources_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_ai_insights: {
        Row: {
          created_at: string
          focus_date: string | null
          generated_by: string | null
          hotel_id: string
          id: string
          organization_slug: string
          payload: Json
        }
        Insert: {
          created_at?: string
          focus_date?: string | null
          generated_by?: string | null
          hotel_id: string
          id?: string
          organization_slug: string
          payload: Json
        }
        Update: {
          created_at?: string
          focus_date?: string | null
          generated_by?: string | null
          hotel_id?: string
          id?: string
          organization_slug?: string
          payload?: Json
        }
        Relationships: []
      }
      revenue_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: Database["public"]["Enums"]["revenue_alert_type"]
          created_at: string
          hotel_id: string
          id: string
          organization_slug: string
          payload: Json
          stay_date: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: Database["public"]["Enums"]["revenue_alert_type"]
          created_at?: string
          hotel_id: string
          id?: string
          organization_slug: string
          payload?: Json
          stay_date?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: Database["public"]["Enums"]["revenue_alert_type"]
          created_at?: string
          hotel_id?: string
          id?: string
          organization_slug?: string
          payload?: Json
          stay_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_automation_notifications: {
        Row: {
          action_ids: string[]
          actions_count: number
          actor_name: string
          actor_user_id: string | null
          automation_run_id: string | null
          changes: Json
          created_at: string
          currency: string | null
          failed_count: number
          hotel_id: string
          id: string
          notification_type: string
          organization_slug: string | null
          pickups_count: number
          push_run_id: string | null
          pushed_count: number
          rule_id: string | null
          run_source: string
          severity: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          action_ids?: string[]
          actions_count?: number
          actor_name?: string
          actor_user_id?: string | null
          automation_run_id?: string | null
          changes?: Json
          created_at?: string
          currency?: string | null
          failed_count?: number
          hotel_id: string
          id?: string
          notification_type?: string
          organization_slug?: string | null
          pickups_count?: number
          push_run_id?: string | null
          pushed_count?: number
          rule_id?: string | null
          run_source?: string
          severity?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          action_ids?: string[]
          actions_count?: number
          actor_name?: string
          actor_user_id?: string | null
          automation_run_id?: string | null
          changes?: Json
          created_at?: string
          currency?: string | null
          failed_count?: number
          hotel_id?: string
          id?: string
          notification_type?: string
          organization_slug?: string | null
          pickups_count?: number
          push_run_id?: string | null
          pushed_count?: number
          rule_id?: string | null
          run_source?: string
          severity?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_automation_notifications_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "revenue_automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_automation_runs: {
        Row: {
          cells_failed: number
          cells_published: number
          cells_queued: number
          cells_verified: number
          created_at: string
          dates_blocked: number
          dates_decreased: number
          dates_evaluated: number
          dates_held: number
          dates_increased: number
          duration_ms: number | null
          failure_reason: string | null
          finished_at: string | null
          hotel_id: string
          id: string
          mode: string
          organization_slug: string
          push_run_id: string | null
          rule_id: string | null
          skip_reasons: Json
          started_at: string
          status: string
        }
        Insert: {
          cells_failed?: number
          cells_published?: number
          cells_queued?: number
          cells_verified?: number
          created_at?: string
          dates_blocked?: number
          dates_decreased?: number
          dates_evaluated?: number
          dates_held?: number
          dates_increased?: number
          duration_ms?: number | null
          failure_reason?: string | null
          finished_at?: string | null
          hotel_id: string
          id?: string
          mode?: string
          organization_slug: string
          push_run_id?: string | null
          rule_id?: string | null
          skip_reasons?: Json
          started_at?: string
          status?: string
        }
        Update: {
          cells_failed?: number
          cells_published?: number
          cells_queued?: number
          cells_verified?: number
          created_at?: string
          dates_blocked?: number
          dates_decreased?: number
          dates_evaluated?: number
          dates_held?: number
          dates_increased?: number
          duration_ms?: number | null
          failure_reason?: string | null
          finished_at?: string | null
          hotel_id?: string
          id?: string
          mode?: string
          organization_slug?: string
          push_run_id?: string | null
          rule_id?: string | null
          skip_reasons?: Json
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      revenue_booking_nights: {
        Row: {
          captured_at: string
          created_at: string
          created_at_pms: string | null
          guests: number | null
          hotel_id: string
          id: string
          nightly_price_eur: number | null
          obj_id: string | null
          obk_id: string | null
          organization_slug: string
          original_nightly_price: number | null
          original_total_price: number | null
          res_id: string
          room_key: string
          room_type_name: string | null
          source_currency: string | null
          source_name: string | null
          status_id: number
          stay_date: string
          stay_from: string | null
          stay_to: string | null
          total_price_eur: number | null
        }
        Insert: {
          captured_at?: string
          created_at?: string
          created_at_pms?: string | null
          guests?: number | null
          hotel_id: string
          id?: string
          nightly_price_eur?: number | null
          obj_id?: string | null
          obk_id?: string | null
          organization_slug: string
          original_nightly_price?: number | null
          original_total_price?: number | null
          res_id: string
          room_key?: string
          room_type_name?: string | null
          source_currency?: string | null
          source_name?: string | null
          status_id?: number
          stay_date: string
          stay_from?: string | null
          stay_to?: string | null
          total_price_eur?: number | null
        }
        Update: {
          captured_at?: string
          created_at?: string
          created_at_pms?: string | null
          guests?: number | null
          hotel_id?: string
          id?: string
          nightly_price_eur?: number | null
          obj_id?: string | null
          obk_id?: string | null
          organization_slug?: string
          original_nightly_price?: number | null
          original_total_price?: number | null
          res_id?: string
          room_key?: string
          room_type_name?: string | null
          source_currency?: string | null
          source_name?: string | null
          status_id?: number
          stay_date?: string
          stay_from?: string | null
          stay_to?: string | null
          total_price_eur?: number | null
        }
        Relationships: []
      }
      revenue_cancelled_nights: {
        Row: {
          cancelled_at: string | null
          created_at: string
          created_at_pms: string | null
          detection_source: string
          guests: number | null
          hotel_id: string
          id: string
          nightly_price_eur: number | null
          obj_id: string | null
          obk_id: string | null
          organization_slug: string | null
          original_nightly_price: number | null
          original_total_price: number | null
          res_id: string
          room_key: string
          room_type_name: string | null
          source_currency: string | null
          source_name: string | null
          status_id: number | null
          stay_date: string
          stay_from: string | null
          stay_to: string | null
          total_price_eur: number | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          created_at_pms?: string | null
          detection_source?: string
          guests?: number | null
          hotel_id: string
          id?: string
          nightly_price_eur?: number | null
          obj_id?: string | null
          obk_id?: string | null
          organization_slug?: string | null
          original_nightly_price?: number | null
          original_total_price?: number | null
          res_id: string
          room_key?: string
          room_type_name?: string | null
          source_currency?: string | null
          source_name?: string | null
          status_id?: number | null
          stay_date: string
          stay_from?: string | null
          stay_to?: string | null
          total_price_eur?: number | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          created_at_pms?: string | null
          detection_source?: string
          guests?: number | null
          hotel_id?: string
          id?: string
          nightly_price_eur?: number | null
          obj_id?: string | null
          obk_id?: string | null
          organization_slug?: string | null
          original_nightly_price?: number | null
          original_total_price?: number | null
          res_id?: string
          room_key?: string
          room_type_name?: string | null
          source_currency?: string | null
          source_name?: string | null
          status_id?: number | null
          stay_date?: string
          stay_from?: string | null
          stay_to?: string | null
          total_price_eur?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      revenue_daily_snapshots: {
        Row: {
          adr_eur: number | null
          captured_at: string
          captured_date: string
          created_at: string
          hotel_id: string
          id: string
          new_bookings: number
          occupancy_pct: number
          organization_slug: string
          revenue_eur: number
          rooms_available: number
          rooms_sold: number
          stay_date: string
        }
        Insert: {
          adr_eur?: number | null
          captured_at?: string
          captured_date: string
          created_at?: string
          hotel_id: string
          id?: string
          new_bookings?: number
          occupancy_pct?: number
          organization_slug: string
          revenue_eur?: number
          rooms_available?: number
          rooms_sold?: number
          stay_date: string
        }
        Update: {
          adr_eur?: number | null
          captured_at?: string
          captured_date?: string
          created_at?: string
          hotel_id?: string
          id?: string
          new_bookings?: number
          occupancy_pct?: number
          organization_slug?: string
          revenue_eur?: number
          rooms_available?: number
          rooms_sold?: number
          stay_date?: string
        }
        Relationships: []
      }
      revenue_date_decisions: {
        Row: {
          adr_feasible: boolean | null
          adr_required_rate: number | null
          anchor_price: number | null
          cancellations_24h: number
          cap_applied: number | null
          cells_simulated: number
          created_at: string
          current_price: number | null
          days_out: number
          decision_reason: string
          direction: string
          event_signal: Json | null
          hold_kind: string | null
          hotel_id: string
          id: string
          limited_by_room_type: string | null
          manual_hold_until: string | null
          market_signal: Json | null
          movement: number
          movement_requested: number | null
          occupancy_pct: number | null
          organization_slug: string
          pace_gap_pct: number | null
          pace_target_pct: number | null
          pickup_1h: number
          pickup_24h: number
          pickup_48h: number
          pickup_6h: number
          pickup_7d: number
          reason_detail: string | null
          rooms_remaining: number | null
          rooms_sold: number | null
          run_id: string
          simulated_cells: Json | null
          status: string
          stay_date: string
          target_price: number | null
          updated_at: string
          window_id: string | null
        }
        Insert: {
          adr_feasible?: boolean | null
          adr_required_rate?: number | null
          anchor_price?: number | null
          cancellations_24h?: number
          cap_applied?: number | null
          cells_simulated?: number
          created_at?: string
          current_price?: number | null
          days_out: number
          decision_reason?: string
          direction?: string
          event_signal?: Json | null
          hold_kind?: string | null
          hotel_id: string
          id?: string
          limited_by_room_type?: string | null
          manual_hold_until?: string | null
          market_signal?: Json | null
          movement?: number
          movement_requested?: number | null
          occupancy_pct?: number | null
          organization_slug: string
          pace_gap_pct?: number | null
          pace_target_pct?: number | null
          pickup_1h?: number
          pickup_24h?: number
          pickup_48h?: number
          pickup_6h?: number
          pickup_7d?: number
          reason_detail?: string | null
          rooms_remaining?: number | null
          rooms_sold?: number | null
          run_id: string
          simulated_cells?: Json | null
          status?: string
          stay_date: string
          target_price?: number | null
          updated_at?: string
          window_id?: string | null
        }
        Update: {
          adr_feasible?: boolean | null
          adr_required_rate?: number | null
          anchor_price?: number | null
          cancellations_24h?: number
          cap_applied?: number | null
          cells_simulated?: number
          created_at?: string
          current_price?: number | null
          days_out?: number
          decision_reason?: string
          direction?: string
          event_signal?: Json | null
          hold_kind?: string | null
          hotel_id?: string
          id?: string
          limited_by_room_type?: string | null
          manual_hold_until?: string | null
          market_signal?: Json | null
          movement?: number
          movement_requested?: number | null
          occupancy_pct?: number | null
          organization_slug?: string
          pace_gap_pct?: number | null
          pace_target_pct?: number | null
          pickup_1h?: number
          pickup_24h?: number
          pickup_48h?: number
          pickup_6h?: number
          pickup_7d?: number
          reason_detail?: string | null
          rooms_remaining?: number | null
          rooms_sold?: number | null
          run_id?: string
          simulated_cells?: Json | null
          status?: string
          stay_date?: string
          target_price?: number | null
          updated_at?: string
          window_id?: string | null
        }
        Relationships: []
      }
      revenue_demand_ratings: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string | null
          event_name: string | null
          hotel_id: string
          id: string
          organization_slug: string | null
          rating: string
          reason: string | null
          stay_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          event_name?: string | null
          hotel_id: string
          id?: string
          organization_slug?: string | null
          rating: string
          reason?: string | null
          stay_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          event_name?: string | null
          hotel_id?: string
          id?: string
          organization_slug?: string | null
          rating?: string
          reason?: string | null
          stay_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenue_digest_settings: {
        Row: {
          enabled: boolean
          hotel_id: string
          last_sent_on: string | null
          organization_slug: string
          recipients: string[]
          send_hour: number
          send_minute: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          hotel_id: string
          last_sent_on?: string | null
          organization_slug: string
          recipients?: string[]
          send_hour?: number
          send_minute?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          hotel_id?: string
          last_sent_on?: string | null
          organization_slug?: string
          recipients?: string[]
          send_hour?: number
          send_minute?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      revenue_engine_config: {
        Row: {
          automation_enabled: boolean
          automation_lock_at: string | null
          automation_lock_hotel: string | null
          dry_run: boolean
          engine_tick_enabled: boolean
          id: string
          pause_reason: string | null
          publisher_lock_at: string | null
          publisher_lock_hotel: string | null
          publisher_lock_token: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          automation_enabled?: boolean
          automation_lock_at?: string | null
          automation_lock_hotel?: string | null
          dry_run?: boolean
          engine_tick_enabled?: boolean
          id?: string
          pause_reason?: string | null
          publisher_lock_at?: string | null
          publisher_lock_hotel?: string | null
          publisher_lock_token?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          automation_enabled?: boolean
          automation_lock_at?: string | null
          automation_lock_hotel?: string | null
          dry_run?: boolean
          engine_tick_enabled?: boolean
          id?: string
          pause_reason?: string | null
          publisher_lock_at?: string | null
          publisher_lock_hotel?: string | null
          publisher_lock_token?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      revenue_event_applications: {
        Row: {
          applied_at: string
          event_key: string
          hotel_id: string
          id: string
          impact: string
          organization_slug: string
          stay_date: string
          uplift_eur: number
        }
        Insert: {
          applied_at?: string
          event_key: string
          hotel_id: string
          id?: string
          impact: string
          organization_slug: string
          stay_date: string
          uplift_eur?: number
        }
        Update: {
          applied_at?: string
          event_key?: string
          hotel_id?: string
          id?: string
          impact?: string
          organization_slug?: string
          stay_date?: string
          uplift_eur?: number
        }
        Relationships: []
      }
      revenue_ingest_runs: {
        Row: {
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          hotel_id: string
          id: string
          organization_slug: string
          rows_ingested: number | null
          source_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          hotel_id: string
          id?: string
          organization_slug: string
          rows_ingested?: number | null
          source_id?: string | null
          started_at?: string
          status: string
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          hotel_id?: string
          id?: string
          organization_slug?: string
          rows_ingested?: number | null
          source_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_ingest_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "hotel_data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_manual_locks: {
        Row: {
          created_at: string
          created_by: string | null
          hotel_id: string
          id: string
          locked_until: string
          organization_slug: string
          reason: string | null
          stay_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hotel_id: string
          id?: string
          locked_until: string
          organization_slug: string
          reason?: string | null
          stay_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hotel_id?: string
          id?: string
          locked_until?: string
          organization_slug?: string
          reason?: string | null
          stay_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenue_notification_reads: {
        Row: {
          created_at: string
          id: string
          notification_id: string
          read_at: string | null
          seen_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notification_id: string
          read_at?: string | null
          seen_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notification_id?: string
          read_at?: string | null
          seen_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "revenue_automation_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_pace_targets: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          max_days_out: number
          min_days_out: number
          month: number | null
          organization_slug: string
          target_occupancy_pct: number
          updated_at: string
          weekday: number | null
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          max_days_out: number
          min_days_out: number
          month?: number | null
          organization_slug: string
          target_occupancy_pct: number
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          max_days_out?: number
          min_days_out?: number
          month?: number | null
          organization_slug?: string
          target_occupancy_pct?: number
          updated_at?: string
          weekday?: number | null
        }
        Relationships: []
      }
      revenue_pickup_actions: {
        Row: {
          clamped_by_min_adr: boolean
          created_at: string
          delta_eur: number
          hotel_id: string
          id: string
          new_price: number | null
          occurred_at: string
          old_price: number | null
          organization_slug: string | null
          stay_date: string
          step_index: number | null
          trigger_detail: string | null
          trigger_kind: string
        }
        Insert: {
          clamped_by_min_adr?: boolean
          created_at?: string
          delta_eur?: number
          hotel_id: string
          id?: string
          new_price?: number | null
          occurred_at?: string
          old_price?: number | null
          organization_slug?: string | null
          stay_date: string
          step_index?: number | null
          trigger_detail?: string | null
          trigger_kind: string
        }
        Update: {
          clamped_by_min_adr?: boolean
          created_at?: string
          delta_eur?: number
          hotel_id?: string
          id?: string
          new_price?: number | null
          occurred_at?: string
          old_price?: number | null
          organization_slug?: string | null
          stay_date?: string
          step_index?: number | null
          trigger_detail?: string | null
          trigger_kind?: string
        }
        Relationships: []
      }
      revenue_pickup_automation_actions: {
        Row: {
          above_market: boolean
          ai_reason: string | null
          cap_applied: number | null
          confirmed_at: string | null
          created_at: string
          decision_id: string | null
          decision_reason: string | null
          decision_type: string
          hold_until: string | null
          hotel_id: string
          id: string
          increase_amount: number
          local_business_date: string | null
          market_median: number | null
          net_pickup: number | null
          new_price: number
          obk_id: string
          observation_from: string | null
          observation_to: string | null
          occupancy: number
          old_price: number | null
          organization_slug: string
          pickup_at: string | null
          pickup_sequence: number
          push_error: string | null
          push_run_id: string | null
          pushed_at: string | null
          reason_detail: string | null
          reservation_id: string | null
          room_type_name: string
          rule_id: string
          rule_version: number
          schedule_slot: string | null
          status: string
          stay_date: string
          updated_at: string
        }
        Insert: {
          above_market?: boolean
          ai_reason?: string | null
          cap_applied?: number | null
          confirmed_at?: string | null
          created_at?: string
          decision_id?: string | null
          decision_reason?: string | null
          decision_type?: string
          hold_until?: string | null
          hotel_id: string
          id?: string
          increase_amount: number
          local_business_date?: string | null
          market_median?: number | null
          net_pickup?: number | null
          new_price: number
          obk_id: string
          observation_from?: string | null
          observation_to?: string | null
          occupancy: number
          old_price?: number | null
          organization_slug: string
          pickup_at?: string | null
          pickup_sequence?: number
          push_error?: string | null
          push_run_id?: string | null
          pushed_at?: string | null
          reason_detail?: string | null
          reservation_id?: string | null
          room_type_name: string
          rule_id: string
          rule_version: number
          schedule_slot?: string | null
          status?: string
          stay_date: string
          updated_at?: string
        }
        Update: {
          above_market?: boolean
          ai_reason?: string | null
          cap_applied?: number | null
          confirmed_at?: string | null
          created_at?: string
          decision_id?: string | null
          decision_reason?: string | null
          decision_type?: string
          hold_until?: string | null
          hotel_id?: string
          id?: string
          increase_amount?: number
          local_business_date?: string | null
          market_median?: number | null
          net_pickup?: number | null
          new_price?: number
          obk_id?: string
          observation_from?: string | null
          observation_to?: string | null
          occupancy?: number
          old_price?: number | null
          organization_slug?: string
          pickup_at?: string | null
          pickup_sequence?: number
          push_error?: string | null
          push_run_id?: string | null
          pushed_at?: string | null
          reason_detail?: string | null
          reservation_id?: string | null
          room_type_name?: string
          rule_id?: string
          rule_version?: number
          schedule_slot?: string | null
          status?: string
          stay_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_pickup_automation_actions_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "revenue_date_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_pickup_automation_actions_push_run_id_fkey"
            columns: ["push_run_id"]
            isOneToOne: false
            referencedRelation: "revenue_rate_push_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_pickup_automation_actions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "revenue_pickup_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_pickup_automation_rules: {
        Row: {
          abnormal_pickup_threshold: number
          adr_guard_enabled: boolean
          adr_target_eur: number | null
          adr_window_days: number
          ai_assist_enabled: boolean
          application_scope: string
          auto_pause_reason: string | null
          auto_publish: boolean
          booked_date_brake_hours: number
          booking_window_tiers: Json
          cancellation_markdown_enabled: boolean
          cancellation_wait_minutes: number
          competitor_max_age_hours_far: number
          competitor_max_age_hours_near: number
          created_at: string
          created_by: string | null
          currency: string
          direction_change_hours: number
          engine_version: number
          evaluation_interval_minutes: number
          event_surcharge_auto: boolean
          event_surcharge_eur: number
          event_uplift_once_per_day: boolean
          expected_sellable_rooms: number | null
          far_out_days: number
          far_out_enabled: boolean
          far_out_floor_topup_amount: number
          far_out_floor_topup_days: number
          far_out_floor_topup_enabled: boolean
          far_out_floor_topup_threshold: number
          far_out_notify: boolean
          far_out_surcharge: number
          fill_max_total_drop_pct: number
          fill_mode_enabled: boolean
          fill_window_days: number
          final_window_abnormal_pickup_rooms: number
          final_window_allow_event_increase: boolean
          final_window_days: number
          final_window_enabled: boolean
          future_booking_window_days: number
          gate_results: Json | null
          high_occupancy_pct: number
          hotel_id: string
          id: string
          immediate_markdown_step: number
          immediate_sell_mode_enabled: boolean
          immediate_window_days: number
          is_enabled: boolean
          last_evaluated_at: string | null
          last_evaluation_error: string | null
          last_evaluation_status: string | null
          last_no_pickup_slot: string | null
          last_run_at: string | null
          last_successful_evaluation_at: string | null
          lead_bands_enabled: boolean
          live_activated_at: string | null
          long_lead_days: number
          low_occupancy_pct: number
          manual_hold_hours: number
          manual_markdown_hold_hours: number
          manual_override_ai_enabled: boolean
          manual_override_review_hours: number
          markdown_depth_pct: number
          markdown_max_occupancy_pct: number
          market_ceiling_multiple: number
          market_validation: Json | null
          max_daily_decrease_per_date: number
          max_daily_increase_pct: number
          max_daily_increase_per_date: number
          max_increase_pct: number
          max_markdowns_per_day: number
          maximum_increase: number | null
          min_movement_eur: number
          minimum_adr: number | null
          mode: string
          month_pace_guard_enabled: boolean
          monthly_adr_targets: Json | null
          name: string
          near_term_days: number
          net_rate_factor_enabled: boolean
          net_rate_factor_override: number | null
          next_run_at: string | null
          no_pickup_decrease: number
          no_pickup_enabled: boolean
          no_pickup_lookback_hours: number
          no_pickup_run_times: string[]
          no_pickup_scope: string
          occupancy_lift_enabled: boolean
          occupancy_lift_ladder: Json | null
          organization_slug: string
          pickup_increase_ladder: Json | null
          pickup_lookback_hours: number
          positive_pickup_enabled: boolean
          protect_high_occupancy: boolean
          raise_on_any_pickup: boolean
          rebook_window_hours: number
          run_budget_ms: number
          run_timezone: string
          same_hour_window_minutes: number
          seasonal_anchor_enabled: boolean
          second_pickup_surcharge: number
          shadow_started_at: string | null
          short_window_days: number
          short_window_guard_enabled: boolean
          short_window_min_occupancy_pct: number
          smart_pricing_enabled: boolean
          sold_out_guard_enabled: boolean
          sold_out_occupancy_pct: number
          spike_detection_enabled: boolean
          spike_lookback_days: number
          spike_threshold_pct: number
          strong_demand_increase: number
          updated_at: string
          updated_by: string | null
          version: number
          whole_number_prices: boolean
          window_rules: Json | null
        }
        Insert: {
          abnormal_pickup_threshold?: number
          adr_guard_enabled?: boolean
          adr_target_eur?: number | null
          adr_window_days?: number
          ai_assist_enabled?: boolean
          application_scope?: string
          auto_pause_reason?: string | null
          auto_publish?: boolean
          booked_date_brake_hours?: number
          booking_window_tiers?: Json
          cancellation_markdown_enabled?: boolean
          cancellation_wait_minutes?: number
          competitor_max_age_hours_far?: number
          competitor_max_age_hours_near?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          direction_change_hours?: number
          engine_version?: number
          evaluation_interval_minutes?: number
          event_surcharge_auto?: boolean
          event_surcharge_eur?: number
          event_uplift_once_per_day?: boolean
          expected_sellable_rooms?: number | null
          far_out_days?: number
          far_out_enabled?: boolean
          far_out_floor_topup_amount?: number
          far_out_floor_topup_days?: number
          far_out_floor_topup_enabled?: boolean
          far_out_floor_topup_threshold?: number
          far_out_notify?: boolean
          far_out_surcharge?: number
          fill_max_total_drop_pct?: number
          fill_mode_enabled?: boolean
          fill_window_days?: number
          final_window_abnormal_pickup_rooms?: number
          final_window_allow_event_increase?: boolean
          final_window_days?: number
          final_window_enabled?: boolean
          future_booking_window_days?: number
          gate_results?: Json | null
          high_occupancy_pct?: number
          hotel_id: string
          id?: string
          immediate_markdown_step?: number
          immediate_sell_mode_enabled?: boolean
          immediate_window_days?: number
          is_enabled?: boolean
          last_evaluated_at?: string | null
          last_evaluation_error?: string | null
          last_evaluation_status?: string | null
          last_no_pickup_slot?: string | null
          last_run_at?: string | null
          last_successful_evaluation_at?: string | null
          lead_bands_enabled?: boolean
          live_activated_at?: string | null
          long_lead_days?: number
          low_occupancy_pct?: number
          manual_hold_hours?: number
          manual_markdown_hold_hours?: number
          manual_override_ai_enabled?: boolean
          manual_override_review_hours?: number
          markdown_depth_pct?: number
          markdown_max_occupancy_pct?: number
          market_ceiling_multiple?: number
          market_validation?: Json | null
          max_daily_decrease_per_date?: number
          max_daily_increase_pct?: number
          max_daily_increase_per_date?: number
          max_increase_pct?: number
          max_markdowns_per_day?: number
          maximum_increase?: number | null
          min_movement_eur?: number
          minimum_adr?: number | null
          mode?: string
          month_pace_guard_enabled?: boolean
          monthly_adr_targets?: Json | null
          name?: string
          near_term_days?: number
          net_rate_factor_enabled?: boolean
          net_rate_factor_override?: number | null
          next_run_at?: string | null
          no_pickup_decrease?: number
          no_pickup_enabled?: boolean
          no_pickup_lookback_hours?: number
          no_pickup_run_times?: string[]
          no_pickup_scope?: string
          occupancy_lift_enabled?: boolean
          occupancy_lift_ladder?: Json | null
          organization_slug: string
          pickup_increase_ladder?: Json | null
          pickup_lookback_hours?: number
          positive_pickup_enabled?: boolean
          protect_high_occupancy?: boolean
          raise_on_any_pickup?: boolean
          rebook_window_hours?: number
          run_budget_ms?: number
          run_timezone?: string
          same_hour_window_minutes?: number
          seasonal_anchor_enabled?: boolean
          second_pickup_surcharge?: number
          shadow_started_at?: string | null
          short_window_days?: number
          short_window_guard_enabled?: boolean
          short_window_min_occupancy_pct?: number
          smart_pricing_enabled?: boolean
          sold_out_guard_enabled?: boolean
          sold_out_occupancy_pct?: number
          spike_detection_enabled?: boolean
          spike_lookback_days?: number
          spike_threshold_pct?: number
          strong_demand_increase?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
          whole_number_prices?: boolean
          window_rules?: Json | null
        }
        Update: {
          abnormal_pickup_threshold?: number
          adr_guard_enabled?: boolean
          adr_target_eur?: number | null
          adr_window_days?: number
          ai_assist_enabled?: boolean
          application_scope?: string
          auto_pause_reason?: string | null
          auto_publish?: boolean
          booked_date_brake_hours?: number
          booking_window_tiers?: Json
          cancellation_markdown_enabled?: boolean
          cancellation_wait_minutes?: number
          competitor_max_age_hours_far?: number
          competitor_max_age_hours_near?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          direction_change_hours?: number
          engine_version?: number
          evaluation_interval_minutes?: number
          event_surcharge_auto?: boolean
          event_surcharge_eur?: number
          event_uplift_once_per_day?: boolean
          expected_sellable_rooms?: number | null
          far_out_days?: number
          far_out_enabled?: boolean
          far_out_floor_topup_amount?: number
          far_out_floor_topup_days?: number
          far_out_floor_topup_enabled?: boolean
          far_out_floor_topup_threshold?: number
          far_out_notify?: boolean
          far_out_surcharge?: number
          fill_max_total_drop_pct?: number
          fill_mode_enabled?: boolean
          fill_window_days?: number
          final_window_abnormal_pickup_rooms?: number
          final_window_allow_event_increase?: boolean
          final_window_days?: number
          final_window_enabled?: boolean
          future_booking_window_days?: number
          gate_results?: Json | null
          high_occupancy_pct?: number
          hotel_id?: string
          id?: string
          immediate_markdown_step?: number
          immediate_sell_mode_enabled?: boolean
          immediate_window_days?: number
          is_enabled?: boolean
          last_evaluated_at?: string | null
          last_evaluation_error?: string | null
          last_evaluation_status?: string | null
          last_no_pickup_slot?: string | null
          last_run_at?: string | null
          last_successful_evaluation_at?: string | null
          lead_bands_enabled?: boolean
          live_activated_at?: string | null
          long_lead_days?: number
          low_occupancy_pct?: number
          manual_hold_hours?: number
          manual_markdown_hold_hours?: number
          manual_override_ai_enabled?: boolean
          manual_override_review_hours?: number
          markdown_depth_pct?: number
          markdown_max_occupancy_pct?: number
          market_ceiling_multiple?: number
          market_validation?: Json | null
          max_daily_decrease_per_date?: number
          max_daily_increase_pct?: number
          max_daily_increase_per_date?: number
          max_increase_pct?: number
          max_markdowns_per_day?: number
          maximum_increase?: number | null
          min_movement_eur?: number
          minimum_adr?: number | null
          mode?: string
          month_pace_guard_enabled?: boolean
          monthly_adr_targets?: Json | null
          name?: string
          near_term_days?: number
          net_rate_factor_enabled?: boolean
          net_rate_factor_override?: number | null
          next_run_at?: string | null
          no_pickup_decrease?: number
          no_pickup_enabled?: boolean
          no_pickup_lookback_hours?: number
          no_pickup_run_times?: string[]
          no_pickup_scope?: string
          occupancy_lift_enabled?: boolean
          occupancy_lift_ladder?: Json | null
          organization_slug?: string
          pickup_increase_ladder?: Json | null
          pickup_lookback_hours?: number
          positive_pickup_enabled?: boolean
          protect_high_occupancy?: boolean
          raise_on_any_pickup?: boolean
          rebook_window_hours?: number
          run_budget_ms?: number
          run_timezone?: string
          same_hour_window_minutes?: number
          seasonal_anchor_enabled?: boolean
          second_pickup_surcharge?: number
          shadow_started_at?: string | null
          short_window_days?: number
          short_window_guard_enabled?: boolean
          short_window_min_occupancy_pct?: number
          smart_pricing_enabled?: boolean
          sold_out_guard_enabled?: boolean
          sold_out_occupancy_pct?: number
          spike_detection_enabled?: boolean
          spike_lookback_days?: number
          spike_threshold_pct?: number
          strong_demand_increase?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
          whole_number_prices?: boolean
          window_rules?: Json | null
        }
        Relationships: []
      }
      revenue_pickup_ledger: {
        Row: {
          cancelled_at: string | null
          created_at: string
          first_seen_at: string
          hotel_id: string
          id: string
          increase_spent_at: string | null
          organization_slug: string
          pms_created_at: string | null
          reservation_id: string
          room_nights: number
          stay_date: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          first_seen_at?: string
          hotel_id: string
          id?: string
          increase_spent_at?: string | null
          organization_slug: string
          pms_created_at?: string | null
          reservation_id: string
          room_nights?: number
          stay_date: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          first_seen_at?: string
          hotel_id?: string
          id?: string
          increase_spent_at?: string | null
          organization_slug?: string
          pms_created_at?: string | null
          reservation_id?: string
          room_nights?: number
          stay_date?: string
        }
        Relationships: []
      }
      revenue_price_floors: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          is_global_safety_max: boolean
          max_price: number | null
          min_price: number | null
          notes: string | null
          occupancy: number | null
          occupancy_supplement: number | null
          organization_slug: string
          room_type_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          is_global_safety_max?: boolean
          max_price?: number | null
          min_price?: number | null
          notes?: string | null
          occupancy?: number | null
          occupancy_supplement?: number | null
          organization_slug: string
          room_type_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          is_global_safety_max?: boolean
          max_price?: number | null
          min_price?: number | null
          notes?: string | null
          occupancy?: number | null
          occupancy_supplement?: number | null
          organization_slug?: string
          room_type_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      revenue_published_payloads: {
        Row: {
          created_at: string
          horizon_from: string
          horizon_to: string
          hotel_id: string
          organization_slug: string
          payload: Json
          sync_completed_at: string
          sync_completed_by_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          horizon_from: string
          horizon_to: string
          hotel_id: string
          organization_slug: string
          payload: Json
          sync_completed_at: string
          sync_completed_by_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          horizon_from?: string
          horizon_to?: string
          hotel_id?: string
          organization_slug?: string
          payload?: Json
          sync_completed_at?: string
          sync_completed_by_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      revenue_rate_alerts: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          notified_at: string | null
          occupancy: number | null
          organization_slug: string | null
          price: number
          room_type_name: string
          severity: string
          stay_date: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          notified_at?: string | null
          occupancy?: number | null
          organization_slug?: string | null
          price: number
          room_type_name: string
          severity?: string
          stay_date: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          notified_at?: string | null
          occupancy?: number | null
          organization_slug?: string | null
          price?: number
          room_type_name?: string
          severity?: string
          stay_date?: string
        }
        Relationships: []
      }
      revenue_rate_drafts: {
        Row: {
          actual_previo_price: number | null
          claimed_at: string | null
          confirmation_status: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          decision_id: string | null
          decision_reason: string | null
          hotel_id: string
          id: string
          intent_source: string | null
          last_checked_at: string | null
          new_price: number
          obk_id: string | null
          occupancy: number
          old_price: number | null
          organization_slug: string | null
          priority: number
          push_attempt_count: number
          push_error: string | null
          push_run_id: string | null
          pushed_at: string | null
          reason_detail: string | null
          reconcile_attempts: number
          reconcile_error: string | null
          reconcile_next_at: string | null
          reconcile_state: string | null
          room_type_name: string
          status: string
          stay_date: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          actual_previo_price?: number | null
          claimed_at?: string | null
          confirmation_status?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          decision_id?: string | null
          decision_reason?: string | null
          hotel_id: string
          id?: string
          intent_source?: string | null
          last_checked_at?: string | null
          new_price: number
          obk_id?: string | null
          occupancy?: number
          old_price?: number | null
          organization_slug?: string | null
          priority?: number
          push_attempt_count?: number
          push_error?: string | null
          push_run_id?: string | null
          pushed_at?: string | null
          reason_detail?: string | null
          reconcile_attempts?: number
          reconcile_error?: string | null
          reconcile_next_at?: string | null
          reconcile_state?: string | null
          room_type_name: string
          status?: string
          stay_date: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          actual_previo_price?: number | null
          claimed_at?: string | null
          confirmation_status?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          decision_id?: string | null
          decision_reason?: string | null
          hotel_id?: string
          id?: string
          intent_source?: string | null
          last_checked_at?: string | null
          new_price?: number
          obk_id?: string | null
          occupancy?: number
          old_price?: number | null
          organization_slug?: string | null
          priority?: number
          push_attempt_count?: number
          push_error?: string | null
          push_run_id?: string | null
          pushed_at?: string | null
          reason_detail?: string | null
          reconcile_attempts?: number
          reconcile_error?: string | null
          reconcile_next_at?: string | null
          reconcile_state?: string | null
          room_type_name?: string
          status?: string
          stay_date?: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_rate_drafts_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "revenue_date_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_rate_push_items: {
        Row: {
          accepted_at: string | null
          actual_previo_price: number | null
          attempt_count: number
          claimed_at: string | null
          confirmed_at: string | null
          created_at: string
          currency: string | null
          decision_id: string | null
          draft_id: string | null
          error: string | null
          hotel_id: string
          id: string
          obk_id: string | null
          occupancy: number
          old_price: number | null
          organization_slug: string | null
          room_type_name: string
          run_id: string
          status: string
          stay_date: string
          target_price: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          actual_previo_price?: number | null
          attempt_count?: number
          claimed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          decision_id?: string | null
          draft_id?: string | null
          error?: string | null
          hotel_id: string
          id?: string
          obk_id?: string | null
          occupancy: number
          old_price?: number | null
          organization_slug?: string | null
          room_type_name: string
          run_id: string
          status?: string
          stay_date: string
          target_price: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          actual_previo_price?: number | null
          attempt_count?: number
          claimed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          decision_id?: string | null
          draft_id?: string | null
          error?: string | null
          hotel_id?: string
          id?: string
          obk_id?: string | null
          occupancy?: number
          old_price?: number | null
          organization_slug?: string | null
          room_type_name?: string
          run_id?: string
          status?: string
          stay_date?: string
          target_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_rate_push_items_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "revenue_date_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_rate_push_items_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "revenue_rate_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_rate_push_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "revenue_rate_push_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_rate_push_runs: {
        Row: {
          accepted_count: number
          automation_run_id: string | null
          compressed_message_count: number
          created_at: string
          created_by: string | null
          date_manifest: Json
          failed_count: number
          finished_at: string | null
          hotel_id: string
          id: string
          last_error: string | null
          organization_slug: string | null
          priority: number
          processed_count: number
          requested_count: number
          source: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_count?: number
          automation_run_id?: string | null
          compressed_message_count?: number
          created_at?: string
          created_by?: string | null
          date_manifest?: Json
          failed_count?: number
          finished_at?: string | null
          hotel_id: string
          id?: string
          last_error?: string | null
          organization_slug?: string | null
          priority?: number
          processed_count?: number
          requested_count?: number
          source?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_count?: number
          automation_run_id?: string | null
          compressed_message_count?: number
          created_at?: string
          created_by?: string | null
          date_manifest?: Json
          failed_count?: number
          finished_at?: string | null
          hotel_id?: string
          id?: string
          last_error?: string | null
          organization_slug?: string | null
          priority?: number
          processed_count?: number
          requested_count?: number
          source?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_rate_push_runs_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "revenue_automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_room_type_rates: {
        Row: {
          captured_at: string
          closed_to_arrival: boolean
          closed_to_departure: boolean
          created_at: string
          currency: string
          hotel_id: string
          id: string
          min_stay: number | null
          obk_id: string
          occupancy: number
          organization_slug: string
          price: number
          rate_plan_id: string
          room_type_name: string | null
          source: string
          stay_date: string
          updated_at: string
        }
        Insert: {
          captured_at?: string
          closed_to_arrival?: boolean
          closed_to_departure?: boolean
          created_at?: string
          currency?: string
          hotel_id: string
          id?: string
          min_stay?: number | null
          obk_id: string
          occupancy?: number
          organization_slug: string
          price: number
          rate_plan_id?: string
          room_type_name?: string | null
          source?: string
          stay_date: string
          updated_at?: string
        }
        Update: {
          captured_at?: string
          closed_to_arrival?: boolean
          closed_to_departure?: boolean
          created_at?: string
          currency?: string
          hotel_id?: string
          id?: string
          min_stay?: number | null
          obk_id?: string
          occupancy?: number
          organization_slug?: string
          price?: number
          rate_plan_id?: string
          room_type_name?: string | null
          source?: string
          stay_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenue_signal_actions: {
        Row: {
          acted_by: string | null
          acted_by_name: string | null
          business_date: string
          created_at: string
          decision: string
          hotel_id: string
          id: string
          note: string | null
          organization_slug: string | null
          signal_key: string
          signal_snapshot: Json
          updated_at: string
        }
        Insert: {
          acted_by?: string | null
          acted_by_name?: string | null
          business_date?: string
          created_at?: string
          decision?: string
          hotel_id: string
          id?: string
          note?: string | null
          organization_slug?: string | null
          signal_key: string
          signal_snapshot?: Json
          updated_at?: string
        }
        Update: {
          acted_by?: string | null
          acted_by_name?: string | null
          business_date?: string
          created_at?: string
          decision?: string
          hotel_id?: string
          id?: string
          note?: string | null
          organization_slug?: string | null
          signal_key?: string
          signal_snapshot?: Json
          updated_at?: string
        }
        Relationships: []
      }
      revenue_signal_runs: {
        Row: {
          business_date: string
          created_at: string
          error: string | null
          hotel_id: string
          id: string
          input_digest: string | null
          model: string | null
          organization_slug: string | null
          signals: Json
          updated_at: string
        }
        Insert: {
          business_date?: string
          created_at?: string
          error?: string | null
          hotel_id: string
          id?: string
          input_digest?: string | null
          model?: string | null
          organization_slug?: string | null
          signals?: Json
          updated_at?: string
        }
        Update: {
          business_date?: string
          created_at?: string
          error?: string | null
          hotel_id?: string
          id?: string
          input_digest?: string | null
          model?: string | null
          organization_slug?: string | null
          signals?: Json
          updated_at?: string
        }
        Relationships: []
      }
      revenue_soldout_prices: {
        Row: {
          captured_at: string
          created_at: string
          currency: string
          hotel_id: string
          id: string
          occupancy: number
          organization_slug: string
          price: number
          released_at: string | null
          room_type_name: string
          stay_date: string
          updated_at: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          currency?: string
          hotel_id: string
          id?: string
          occupancy: number
          organization_slug: string
          price: number
          released_at?: string | null
          room_type_name: string
          stay_date: string
          updated_at?: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          currency?: string
          hotel_id?: string
          id?: string
          occupancy?: number
          organization_slug?: string
          price?: number
          released_at?: string | null
          room_type_name?: string
          stay_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenue_sync_state: {
        Row: {
          hotel_id: string
          last_error: string | null
          last_success_at: string | null
          last_success_by: string | null
          last_success_by_name: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_started_at: string | null
          organization_slug: string
          updated_at: string
        }
        Insert: {
          hotel_id: string
          last_error?: string | null
          last_success_at?: string | null
          last_success_by?: string | null
          last_success_by_name?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_started_at?: string | null
          organization_slug: string
          updated_at?: string
        }
        Update: {
          hotel_id?: string
          last_error?: string | null
          last_success_at?: string | null
          last_success_by?: string | null
          last_success_by_name?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_started_at?: string | null
          organization_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_sync_state_last_success_by_fkey"
            columns: ["last_success_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_analysis_runs: {
        Row: {
          cached: boolean
          completion_tokens: number
          created_at: string
          created_by: string | null
          data_fingerprint: string | null
          error: string | null
          estimated_cost_usd: number
          hotel_id: string
          id: string
          metrics: Json
          mode: string
          model: string | null
          organization_slug: string | null
          output: Json | null
          period_end: string | null
          period_start: string | null
          prompt_tokens: number
          prompt_version: string
          status: string
          total_tokens: number
        }
        Insert: {
          cached?: boolean
          completion_tokens?: number
          created_at?: string
          created_by?: string | null
          data_fingerprint?: string | null
          error?: string | null
          estimated_cost_usd?: number
          hotel_id: string
          id?: string
          metrics?: Json
          mode?: string
          model?: string | null
          organization_slug?: string | null
          output?: Json | null
          period_end?: string | null
          period_start?: string | null
          prompt_tokens?: number
          prompt_version?: string
          status?: string
          total_tokens?: number
        }
        Update: {
          cached?: boolean
          completion_tokens?: number
          created_at?: string
          created_by?: string | null
          data_fingerprint?: string | null
          error?: string | null
          estimated_cost_usd?: number
          hotel_id?: string
          id?: string
          metrics?: Json
          mode?: string
          model?: string | null
          organization_slug?: string | null
          output?: Json | null
          period_end?: string | null
          period_start?: string | null
          prompt_tokens?: number
          prompt_version?: string
          status?: string
          total_tokens?: number
        }
        Relationships: []
      }
      rm_recommendations: {
        Row: {
          acted_at: string | null
          acted_by: string | null
          action: string
          arrival_date: string | null
          category: string
          confidence: number
          created_at: string
          evidence: Json
          expected_impact: Json
          expires_at: string | null
          feedback: string | null
          feedback_note: string | null
          headline: string
          hotel_id: string
          id: string
          organization_slug: string | null
          outcome: Json | null
          priority: number
          reason: string | null
          recommended_cta: string | null
          risk: string | null
          room_type: string | null
          run_id: string
          status: string
          updated_at: string
          urgency: string
        }
        Insert: {
          acted_at?: string | null
          acted_by?: string | null
          action: string
          arrival_date?: string | null
          category?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          expected_impact?: Json
          expires_at?: string | null
          feedback?: string | null
          feedback_note?: string | null
          headline: string
          hotel_id: string
          id?: string
          organization_slug?: string | null
          outcome?: Json | null
          priority?: number
          reason?: string | null
          recommended_cta?: string | null
          risk?: string | null
          room_type?: string | null
          run_id: string
          status?: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          acted_at?: string | null
          acted_by?: string | null
          action?: string
          arrival_date?: string | null
          category?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          expected_impact?: Json
          expires_at?: string | null
          feedback?: string | null
          feedback_note?: string | null
          headline?: string
          hotel_id?: string
          id?: string
          organization_slug?: string | null
          outcome?: Json | null
          priority?: number
          reason?: string | null
          recommended_cta?: string | null
          risk?: string | null
          room_type?: string | null
          run_id?: string
          status?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_recommendations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "rm_analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      room_assignments: {
        Row: {
          assigned_by: string
          assigned_to: string
          assignment_date: string
          assignment_type: Database["public"]["Enums"]["assignment_type"]
          break_periods: Json | null
          completed_at: string | null
          completion_photos: string[] | null
          created_at: string
          dnd_attempt_count: number
          dnd_first_attempt_at: string | null
          dnd_marked_at: string | null
          dnd_marked_by: string | null
          dnd_retry_unlocked_at: string | null
          estimated_duration: number | null
          id: string
          is_dnd: boolean | null
          notes: string | null
          organization_slug: string | null
          pms_hold: boolean
          pms_hold_event_id: string | null
          pms_hold_reason: string | null
          priority: number
          ready_to_clean: boolean
          room_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          supervisor_approved: boolean | null
          supervisor_approved_at: string | null
          supervisor_approved_by: string | null
          total_break_time_minutes: number | null
          updated_at: string
        }
        Insert: {
          assigned_by: string
          assigned_to: string
          assignment_date?: string
          assignment_type?: Database["public"]["Enums"]["assignment_type"]
          break_periods?: Json | null
          completed_at?: string | null
          completion_photos?: string[] | null
          created_at?: string
          dnd_attempt_count?: number
          dnd_first_attempt_at?: string | null
          dnd_marked_at?: string | null
          dnd_marked_by?: string | null
          dnd_retry_unlocked_at?: string | null
          estimated_duration?: number | null
          id?: string
          is_dnd?: boolean | null
          notes?: string | null
          organization_slug?: string | null
          pms_hold?: boolean
          pms_hold_event_id?: string | null
          pms_hold_reason?: string | null
          priority?: number
          ready_to_clean?: boolean
          room_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          supervisor_approved?: boolean | null
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          total_break_time_minutes?: number | null
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          assigned_to?: string
          assignment_date?: string
          assignment_type?: Database["public"]["Enums"]["assignment_type"]
          break_periods?: Json | null
          completed_at?: string | null
          completion_photos?: string[] | null
          created_at?: string
          dnd_attempt_count?: number
          dnd_first_attempt_at?: string | null
          dnd_marked_at?: string | null
          dnd_marked_by?: string | null
          dnd_retry_unlocked_at?: string | null
          estimated_duration?: number | null
          id?: string
          is_dnd?: boolean | null
          notes?: string | null
          organization_slug?: string | null
          pms_hold?: boolean
          pms_hold_event_id?: string | null
          pms_hold_reason?: string | null
          priority?: number
          ready_to_clean?: boolean
          room_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          supervisor_approved?: boolean | null
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
          total_break_time_minutes?: number | null
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
          {
            foreignKeyName: "room_assignments_supervisor_approved_by_fkey"
            columns: ["supervisor_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_minibar_usage: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          cleared_note: string | null
          created_at: string
          guest_checkout_date: string | null
          id: string
          is_cleared: boolean | null
          minibar_item_id: string
          organization_slug: string | null
          quantity_used: number | null
          recorded_by: string | null
          room_id: string
          source: string | null
          updated_at: string
          usage_date: string | null
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_note?: string | null
          created_at?: string
          guest_checkout_date?: string | null
          id?: string
          is_cleared?: boolean | null
          minibar_item_id: string
          organization_slug?: string | null
          quantity_used?: number | null
          recorded_by?: string | null
          room_id: string
          source?: string | null
          updated_at?: string
          usage_date?: string | null
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_note?: string | null
          created_at?: string
          guest_checkout_date?: string | null
          id?: string
          is_cleared?: boolean | null
          minibar_item_id?: string
          organization_slug?: string | null
          quantity_used?: number | null
          recorded_by?: string | null
          room_id?: string
          source?: string | null
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
      room_types: {
        Row: {
          base_price_eur: number
          counts_toward_inventory: boolean
          created_at: string
          derivation_mode: string
          derivation_value: number
          hotel_id: string
          id: string
          is_reference: boolean
          is_sellable: boolean
          max_price_eur: number
          min_price_eur: number
          name: string
          name_translations: Json
          num_rooms: number
          organization_slug: string
          pms_rate_id: string | null
          pms_room_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          base_price_eur?: number
          counts_toward_inventory?: boolean
          created_at?: string
          derivation_mode?: string
          derivation_value?: number
          hotel_id: string
          id?: string
          is_reference?: boolean
          is_sellable?: boolean
          max_price_eur?: number
          min_price_eur?: number
          name: string
          name_translations?: Json
          num_rooms?: number
          organization_slug: string
          pms_rate_id?: string | null
          pms_room_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          base_price_eur?: number
          counts_toward_inventory?: boolean
          created_at?: string
          derivation_mode?: string
          derivation_value?: number
          hotel_id?: string
          id?: string
          is_reference?: boolean
          is_sellable?: boolean
          max_price_eur?: number
          min_price_eur?: number
          name?: string
          name_translations?: Json
          num_rooms?: number
          organization_slug?: string
          pms_rate_id?: string | null
          pms_room_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          bed_configuration: string | null
          bed_type: string | null
          checkout_time: string | null
          created_at: string
          dnd_marked_at: string | null
          dnd_marked_by: string | null
          elevator_proximity: number | null
          floor_number: number | null
          guest_count: number | null
          guest_nights_stayed: number | null
          hotel: string
          id: string
          is_checkout_room: boolean | null
          is_dnd: boolean | null
          last_cleaned_at: string | null
          last_cleaned_by: string | null
          last_linen_change: string | null
          last_towel_change: string | null
          linen_change_required: boolean | null
          minibar_qr_token: string | null
          notes: string | null
          organization_slug: string | null
          pms_metadata: Json | null
          room_capacity: number | null
          room_category: string | null
          room_name: string | null
          room_number: string
          room_size_sqm: number | null
          room_type: string | null
          status: string | null
          towel_change_required: boolean | null
          updated_at: string
          venue_id: string | null
          wing: string | null
        }
        Insert: {
          bed_configuration?: string | null
          bed_type?: string | null
          checkout_time?: string | null
          created_at?: string
          dnd_marked_at?: string | null
          dnd_marked_by?: string | null
          elevator_proximity?: number | null
          floor_number?: number | null
          guest_count?: number | null
          guest_nights_stayed?: number | null
          hotel: string
          id?: string
          is_checkout_room?: boolean | null
          is_dnd?: boolean | null
          last_cleaned_at?: string | null
          last_cleaned_by?: string | null
          last_linen_change?: string | null
          last_towel_change?: string | null
          linen_change_required?: boolean | null
          minibar_qr_token?: string | null
          notes?: string | null
          organization_slug?: string | null
          pms_metadata?: Json | null
          room_capacity?: number | null
          room_category?: string | null
          room_name?: string | null
          room_number: string
          room_size_sqm?: number | null
          room_type?: string | null
          status?: string | null
          towel_change_required?: boolean | null
          updated_at?: string
          venue_id?: string | null
          wing?: string | null
        }
        Update: {
          bed_configuration?: string | null
          bed_type?: string | null
          checkout_time?: string | null
          created_at?: string
          dnd_marked_at?: string | null
          dnd_marked_by?: string | null
          elevator_proximity?: number | null
          floor_number?: number | null
          guest_count?: number | null
          guest_nights_stayed?: number | null
          hotel?: string
          id?: string
          is_checkout_room?: boolean | null
          is_dnd?: boolean | null
          last_cleaned_at?: string | null
          last_cleaned_by?: string | null
          last_linen_change?: string | null
          last_towel_change?: string | null
          linen_change_required?: boolean | null
          minibar_qr_token?: string | null
          notes?: string | null
          organization_slug?: string | null
          pms_metadata?: Json | null
          room_capacity?: number | null
          room_category?: string | null
          room_name?: string | null
          room_number?: string
          room_size_sqm?: number | null
          room_type?: string | null
          status?: string | null
          towel_change_required?: boolean | null
          updated_at?: string
          venue_id?: string | null
          wing?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_last_cleaned_by_fkey"
            columns: ["last_cleaned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance: {
        Row: {
          break_duration: number | null
          break_duration_minutes: number | null
          break_ended_at: string | null
          break_started_at: string | null
          break_type: string | null
          check_in_location: Json | null
          check_in_time: string
          check_out_location: Json | null
          check_out_time: string | null
          created_at: string
          id: string
          notes: string | null
          organization_slug: string | null
          status: string
          total_hours: number | null
          updated_at: string
          user_id: string
          work_date: string
        }
        Insert: {
          break_duration?: number | null
          break_duration_minutes?: number | null
          break_ended_at?: string | null
          break_started_at?: string | null
          break_type?: string | null
          check_in_location?: Json | null
          check_in_time?: string
          check_out_location?: Json | null
          check_out_time?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_slug?: string | null
          status?: string
          total_hours?: number | null
          updated_at?: string
          user_id: string
          work_date?: string
        }
        Update: {
          break_duration?: number | null
          break_duration_minutes?: number | null
          break_ended_at?: string | null
          break_started_at?: string | null
          break_type?: string | null
          check_in_location?: Json | null
          check_in_time?: string
          check_out_location?: Json | null
          check_out_time?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_slug?: string | null
          status?: string
          total_hours?: number | null
          updated_at?: string
          user_id?: string
          work_date?: string
        }
        Relationships: []
      }
      staff_schedule_venues: {
        Row: {
          created_at: string
          schedule_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          schedule_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          schedule_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedule_venues_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "staff_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_schedule_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_schedules: {
        Row: {
          created_at: string
          created_by: string
          hotel_id: string
          id: string
          notes: string | null
          organization_slug: string
          published_at: string | null
          published_by: string | null
          shift_end: string
          shift_start: string
          status: string
          updated_at: string
          user_id: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by: string
          hotel_id: string
          id?: string
          notes?: string | null
          organization_slug: string
          published_at?: string | null
          published_by?: string | null
          shift_end?: string
          shift_start?: string
          status?: string
          updated_at?: string
          user_id: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by?: string
          hotel_id?: string
          id?: string
          notes?: string | null
          organization_slug?: string
          published_at?: string | null
          published_by?: string | null
          shift_end?: string
          shift_start?: string
          status?: string
          updated_at?: string
          user_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_schedules_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_schedules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      surge_events: {
        Row: {
          bookings_in_window: number
          hotel_id: string
          id: string
          notified_at: string | null
          organization_slug: string
          stay_date: string
          triggered_at: string
        }
        Insert: {
          bookings_in_window: number
          hotel_id: string
          id?: string
          notified_at?: string | null
          organization_slug: string
          stay_date: string
          triggered_at?: string
        }
        Update: {
          bookings_in_window?: number
          hotel_id?: string
          id?: string
          notified_at?: string | null
          organization_slug?: string
          stay_date?: string
          triggered_at?: string
        }
        Relationships: []
      }
      surge_settings: {
        Row: {
          hotel_id: string
          only_after_days: number
          organization_slug: string
          recipients: string[]
          send_email: boolean
          threshold_bookings: number
          updated_at: string
          window_hours: number
        }
        Insert: {
          hotel_id: string
          only_after_days?: number
          organization_slug: string
          recipients?: string[]
          send_email?: boolean
          threshold_bookings?: number
          updated_at?: string
          window_hours?: number
        }
        Update: {
          hotel_id?: string
          only_after_days?: number
          organization_slug?: string
          recipients?: string[]
          send_email?: boolean
          threshold_bookings?: number
          updated_at?: string
          window_hours?: number
        }
        Relationships: []
      }
      system_announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          pinned: boolean
          published: boolean
          starts_at: string
          target_org_slugs: string[]
          target_roles: string[]
          title: string
          tone: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          pinned?: boolean
          published?: boolean
          starts_at?: string
          target_org_slugs?: string[]
          target_roles?: string[]
          title: string
          tone?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          pinned?: boolean
          published?: boolean
          starts_at?: string
          target_org_slugs?: string[]
          target_roles?: string[]
          title?: string
          tone?: string
          updated_at?: string
        }
        Relationships: []
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
          completion_photos: string[] | null
          created_at: string | null
          created_by: string
          department: string | null
          description: string
          hold_reason: string | null
          hotel: string | null
          id: string
          on_hold: boolean | null
          organization_slug: string | null
          pending_supervisor_approval: boolean | null
          photo_url: string | null
          priority: Database["public"]["Enums"]["ticket_priority"]
          resolution_text: string | null
          room_number: string
          sla_breach_reason: string | null
          sla_due_date: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          sub_category: string | null
          sub_sub_category: string | null
          supervisor_approved: boolean | null
          supervisor_approved_at: string | null
          supervisor_approved_by: string | null
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
          completion_photos?: string[] | null
          created_at?: string | null
          created_by: string
          department?: string | null
          description: string
          hold_reason?: string | null
          hotel?: string | null
          id?: string
          on_hold?: boolean | null
          organization_slug?: string | null
          pending_supervisor_approval?: boolean | null
          photo_url?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          resolution_text?: string | null
          room_number: string
          sla_breach_reason?: string | null
          sla_due_date?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          sub_category?: string | null
          sub_sub_category?: string | null
          supervisor_approved?: boolean | null
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
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
          completion_photos?: string[] | null
          created_at?: string | null
          created_by?: string
          department?: string | null
          description?: string
          hold_reason?: string | null
          hotel?: string | null
          id?: string
          on_hold?: boolean | null
          organization_slug?: string | null
          pending_supervisor_approval?: boolean | null
          photo_url?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          resolution_text?: string | null
          room_number?: string
          sla_breach_reason?: string | null
          sla_due_date?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          sub_category?: string | null
          sub_sub_category?: string | null
          supervisor_approved?: boolean | null
          supervisor_approved_at?: string | null
          supervisor_approved_by?: string | null
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
          {
            foreignKeyName: "tickets_supervisor_approved_by_fkey"
            columns: ["supervisor_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_guide_steps: {
        Row: {
          action_type: string | null
          created_at: string | null
          cta_label_key: string | null
          guide_id: string
          highlight_padding: number | null
          id: string
          media_url: string | null
          optional: boolean
          position: string | null
          precondition: string | null
          requires_action: boolean | null
          route: string | null
          step_key: string
          step_order: number
          tab: string | null
          target_selector: string | null
          wait_for_event: string | null
        }
        Insert: {
          action_type?: string | null
          created_at?: string | null
          cta_label_key?: string | null
          guide_id: string
          highlight_padding?: number | null
          id?: string
          media_url?: string | null
          optional?: boolean
          position?: string | null
          precondition?: string | null
          requires_action?: boolean | null
          route?: string | null
          step_key: string
          step_order: number
          tab?: string | null
          target_selector?: string | null
          wait_for_event?: string | null
        }
        Update: {
          action_type?: string | null
          created_at?: string | null
          cta_label_key?: string | null
          guide_id?: string
          highlight_padding?: number | null
          id?: string
          media_url?: string | null
          optional?: boolean
          position?: string | null
          precondition?: string | null
          requires_action?: boolean | null
          route?: string | null
          step_key?: string
          step_order?: number
          tab?: string | null
          target_selector?: string | null
          wait_for_event?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_guide_steps_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "training_guides"
            referencedColumns: ["id"]
          },
        ]
      }
      training_guides: {
        Row: {
          auto_start: boolean
          category: string
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number
          slug: string
          sort_order: number | null
          target_role: string | null
          target_roles: string[] | null
          total_steps: number | null
          updated_at: string | null
        }
        Insert: {
          auto_start?: boolean
          category?: string
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number
          slug: string
          sort_order?: number | null
          target_role?: string | null
          target_roles?: string[] | null
          total_steps?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_start?: boolean
          category?: string
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number
          slug?: string
          sort_order?: number | null
          target_role?: string | null
          target_roles?: string[] | null
          total_steps?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_property_scopes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_slug: string
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_slug: string
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_slug?: string
          updated_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_property_scopes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tour_progress: {
        Row: {
          completed_at: string
          completed_steps: number[]
          current_step: number
          status: string
          tour_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          completed_steps?: number[]
          current_step?: number
          status?: string
          tour_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string
          completed_steps?: number[]
          current_step?: number
          status?: string
          tour_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tour_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_training_assignments: {
        Row: {
          assigned_by: string | null
          completed_at: string | null
          completed_steps: Json | null
          created_at: string | null
          current_step: number | null
          guide_id: string
          id: string
          organization_slug: string | null
          started_at: string | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          completed_at?: string | null
          completed_steps?: Json | null
          created_at?: string | null
          current_step?: number | null
          guide_id: string
          id?: string
          organization_slug?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          completed_at?: string | null
          completed_steps?: Json | null
          created_at?: string | null
          current_step?: number | null
          guide_id?: string
          id?: string
          organization_slug?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_training_assignments_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "training_guides"
            referencedColumns: ["id"]
          },
        ]
      }
      user_training_state: {
        Row: {
          auto_start_pending: boolean
          deferred_steps: Json
          dismissed_until: string | null
          last_active_step_key: string | null
          last_auto_start_at: string | null
          last_guide_slug: string | null
          last_step: number
          paused_at: string | null
          seen_promos: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_start_pending?: boolean
          deferred_steps?: Json
          dismissed_until?: string | null
          last_active_step_key?: string | null
          last_auto_start_at?: string | null
          last_guide_slug?: string | null
          last_step?: number
          paused_at?: string | null
          seen_promos?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_start_pending?: boolean
          deferred_steps?: Json
          dismissed_until?: string | null
          last_active_step_key?: string | null
          last_auto_start_at?: string | null
          last_guide_slug?: string | null
          last_step?: number
          paused_at?: string | null
          seen_promos?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address: string | null
          created_at: string
          hotel_id: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          hotel_id: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          hotel_id?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      yielding_tags: {
        Row: {
          aggressiveness: string
          colour: string
          created_at: string
          hotel_id: string
          id: string
          max_pct: number
          min_pct: number
          name: string
          organization_slug: string
          room_type_id: string | null
        }
        Insert: {
          aggressiveness?: string
          colour?: string
          created_at?: string
          hotel_id: string
          id?: string
          max_pct?: number
          min_pct?: number
          name: string
          organization_slug: string
          room_type_id?: string | null
        }
        Update: {
          aggressiveness?: string
          colour?: string
          created_at?: string
          hotel_id?: string
          id?: string
          max_pct?: number
          min_pct?: number
          name?: string
          organization_slug?: string
          room_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "yielding_tags_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_training_completion_by_role: {
        Row: {
          completed_users: number | null
          completion_pct: number | null
          curriculum_slug: string | null
          in_progress_users: number | null
          role: string | null
          total_users: number | null
        }
        Relationships: []
      }
      v_training_dismissals: {
        Row: {
          dismissed_count: number | null
          paused_count: number | null
        }
        Relationships: []
      }
      v_training_step_funnel: {
        Row: {
          curriculum_slug: string | null
          role: string | null
          step_idx: number | null
          users_reached: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      ai_spend_snapshot: {
        Args: { _org: string }
        Returns: {
          daily_budget: number
          monthly_budget: number
          spend_month: number
          spend_today: number
          within_budget: boolean
        }[]
      }
      billable_room_count: { Args: { _hotel_id: string }; Returns: number }
      billing_realised_revenue: {
        Args: { _from: string; _hotel_id: string; _to: string }
        Returns: {
          revenue_eur: number
          room_nights: number
        }[]
      }
      can_manage_slnt_schedule: {
        Args: { _hotel_id: string }
        Returns: boolean
      }
      can_view_training_analytics: {
        Args: { _user_id: string }
        Returns: boolean
      }
      capture_revenue_soldout_prices: {
        Args: { _hotel_id: string }
        Returns: undefined
      }
      claim_automation_lock: {
        Args: { p_hotel: string; p_stale_minutes?: number }
        Returns: boolean
      }
      claim_competitor_scan_lease: {
        Args: { _id: string; _minutes: number }
        Returns: boolean
      }
      claim_due_automation_rule: {
        Args: never
        Returns: {
          hotel_id: string
          interval_minutes: number
          rule_id: string
        }[]
      }
      claim_next_push_run: {
        Args: { p_stale_minutes?: number }
        Returns: {
          hotel_id: string
          priority: number
          run_id: string
          run_status: string
        }[]
      }
      claim_next_revenue_sync: {
        Args: { _fresh_for?: string; _lease_for?: string }
        Returns: {
          out_hotel_id: string
          out_organization_slug: string
        }[]
      }
      claim_publisher_lease: {
        Args: { p_hotel: string; p_stale_minutes?: number; p_token: string }
        Returns: boolean
      }
      claim_publisher_lock: {
        Args: { p_hotel: string; p_stale_minutes?: number }
        Returns: boolean
      }
      claim_revenue_sync:
        | {
            Args: {
              _fresh_for?: string
              _hotel_id: string
              _lease_for?: string
            }
            Returns: {
              last_success_at: string
              status: string
            }[]
          }
        | {
            Args: {
              _force?: boolean
              _fresh_for?: string
              _hotel_id: string
              _lease_for?: string
            }
            Returns: {
              last_success_at: string
              status: string
            }[]
          }
      cleanup_old_photos: { Args: never; Returns: undefined }
      complete_revenue_sync:
        | {
            Args: {
              _actor_id: string
              _actor_name?: string
              _error?: string
              _hotel_id: string
              _success: boolean
            }
            Returns: undefined
          }
        | {
            Args: { _error?: string; _hotel_id: string; _success: boolean }
            Returns: undefined
          }
      create_authenticated_housekeeper: {
        Args: {
          p_assigned_hotel?: string
          p_email?: string
          p_full_name: string
          p_password?: string
          p_phone_number?: string
          p_username?: string
        }
        Returns: Json
      }
      create_user_with_profile:
        | {
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
        | {
            Args: {
              p_assigned_hotel?: string
              p_email?: string
              p_full_name: string
              p_password?: string
              p_phone_number?: string
              p_role?: Database["public"]["Enums"]["user_role"]
              p_username?: string
            }
            Returns: Json
          }
      create_user_with_profile_v2: {
        Args: {
          p_assigned_hotel?: string
          p_email?: string
          p_full_name: string
          p_password?: string
          p_phone_number?: string
          p_role?: Database["public"]["Enums"]["user_role"]
          p_username?: string
        }
        Returns: Json
      }
      delete_user_profile: { Args: { p_user_id: string }; Returns: Json }
      delete_user_profile_v2: {
        Args: { p_reassign_to: string; p_user_id: string }
        Returns: Json
      }
      expire_stale_recommendations: { Args: never; Returns: number }
      fin_can_approve: { Args: { _user_id?: string }; Returns: boolean }
      fin_is_admin: { Args: { _user_id?: string }; Returns: boolean }
      fin_profile: {
        Args: { _user_id?: string }
        Returns: Database["public"]["Enums"]["finance_profile"]
      }
      fin_scope_ok: {
        Args: { _company_id: string; _hotel_id: string; _user_id?: string }
        Returns: boolean
      }
      generate_ticket_number: { Args: never; Returns: string }
      get_assignable_staff:
        | {
            Args: { hotel_filter?: string }
            Returns: {
              assigned_hotel: string
              email: string
              full_name: string
              id: string
              role: string
            }[]
          }
        | {
            Args: {
              requesting_user_role: Database["public"]["Enums"]["user_role"]
            }
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
      get_attendance_records_hotel_filtered: {
        Args: {
          end_date?: string
          start_date?: string
          target_user_id?: string
        }
        Returns: {
          break_duration: number
          check_in_location: Json
          check_in_time: string
          check_out_location: Json
          check_out_time: string
          full_name: string
          id: string
          notes: string
          role: string
          status: string
          total_hours: number
          user_id: string
          work_date: string
        }[]
      }
      get_attendance_records_secure: {
        Args: {
          end_date?: string
          start_date?: string
          target_user_id?: string
        }
        Returns: {
          break_duration: number
          check_in_location: Json
          check_in_time: string
          check_out_location: Json
          check_out_time: string
          full_name: string
          id: string
          notes: string
          role: string
          status: string
          total_hours: number
          user_id: string
          work_date: string
        }[]
      }
      get_attendance_summary: {
        Args: {
          end_date?: string
          start_date?: string
          target_user_id?: string
        }
        Returns: Json
      }
      get_attendance_summary_secure: {
        Args: {
          end_date?: string
          start_date?: string
          target_user_id?: string
        }
        Returns: Json
      }
      get_current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_email_by_nickname: { Args: { p_nickname: string }; Returns: string }
      get_email_case_insensitive: { Args: { p_email: string }; Returns: string }
      get_employees_by_hotel: {
        Args: never
        Returns: {
          assigned_hotel: string
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      get_hotel_id_from_name: { Args: { hotel_name: string }; Returns: string }
      get_hotel_name_from_id: { Args: { hotel_id: string }; Returns: string }
      get_housekeeper_avg_rating: {
        Args: { days_back?: number; p_housekeeper_id: string }
        Returns: number
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
      get_next_housekeeper_sequence: {
        Args: { p_org_slug: string }
        Returns: number
      }
      get_pms_upload_hidden: { Args: { hotel_key: string }; Returns: boolean }
      get_public_breakfast_hotels: {
        Args: { _org_slug: string }
        Returns: {
          breakfast_restaurants: Json
          custom_app_name: string
          custom_logo_url: string
          custom_primary_color: string
          hotel_id: string
          hotel_name: string
          organization_name: string
          organization_slug: string
        }[]
      }
      get_revenue_published_payload: {
        Args: { _hotel_id: string }
        Returns: {
          horizon_from: string
          horizon_to: string
          payload: Json
          sync_completed_at: string
          sync_completed_by_name: string
        }[]
      }
      get_revenue_published_payload_window: {
        Args: { _horizon_days?: number; _hotel_id: string }
        Returns: {
          horizon_from: string
          horizon_to: string
          payload: Json
          sync_completed_at: string
          sync_completed_by_name: string
        }[]
      }
      get_user_access_config: {
        Args: { user_role: Database["public"]["Enums"]["user_role"] }
        Returns: {
          access_scope: string
          can_manage_all: boolean
          department: string
        }[]
      }
      get_user_assigned_hotel: { Args: { user_id: string }; Returns: string }
      get_user_organization_hotels: {
        Args: never
        Returns: {
          hotel_id: string
          hotel_name: string
          id: string
          is_active: boolean
          organization_id: string
          settings: Json
        }[]
      }
      get_user_organization_slug: { Args: { user_id: string }; Returns: string }
      get_user_role: {
        Args: { user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_user_role_safe: {
        Args: { user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      has_hk_manager_powers: { Args: { _user_id: string }; Returns: boolean }
      has_pms_access: { Args: { user_id: string }; Returns: boolean }
      has_ticket_creation_permission: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_venue_access: {
        Args: { _user_id: string; _venue_id: string }
        Returns: boolean
      }
      hotel_belongs_to_user_organization: {
        Args: { _hotel_id: string; _uid: string }
        Returns: boolean
      }
      hotel_has_active_previo: { Args: { _hotel_id: string }; Returns: boolean }
      is_revenue_user: { Args: { _uid: string }; Returns: boolean }
      is_super_admin: { Args: { user_id: string }; Returns: boolean }
      is_top_management: { Args: { _user_id: string }; Returns: boolean }
      manager_assignable_role: {
        Args: { _role: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      market_rates_by_date: {
        Args: {
          _from: string
          _hotel_id: string
          _max_age_hours?: number
          _to: string
        }
        Returns: {
          avg_rate: number
          freshest_at: string
          max_rate: number
          median_rate: number
          min_rate: number
          sample_size: number
          stale: boolean
          stay_date: string
          trimmed_avg_rate: number
        }[]
      }
      normalize_hotel_name: { Args: { input_hotel: string }; Returns: string }
      organization_has_custom_branding: {
        Args: { org_slug: string }
        Returns: boolean
      }
      pause_competitor_scan: {
        Args: { _id: string; _minutes: number; _reason: string }
        Returns: undefined
      }
      pi_analytics_breakdown: {
        Args: {
          _approval_status?: string
          _company_id?: string
          _dimension?: string
          _from?: string
          _hotel_id?: string
          _limit?: number
          _to?: string
        }
        Returns: {
          credit_total: number
          invoice_count: number
          label: string
          spend: number
        }[]
      }
      pi_analytics_buckets: {
        Args: {
          _approval_status?: string
          _bucket?: string
          _category_id?: string
          _company_id?: string
          _cost_centre_id?: string
          _from?: string
          _hotel_id?: string
          _merchant?: string
          _to?: string
        }
        Returns: {
          bucket: string
          invoice_count: number
          spend: number
          vat: number
        }[]
      }
      pi_analytics_summary: {
        Args: {
          _approval_status?: string
          _category_id?: string
          _company_id?: string
          _cost_centre_id?: string
          _currency?: string
          _from?: string
          _hotel_id?: string
          _merchant?: string
          _review_status?: string
          _to?: string
        }
        Returns: {
          approval_rate: number
          approved: number
          avg_amount: number
          duplicate_alerts: number
          extraction_rate: number
          invoice_count: number
          pending_approval: number
          pending_approval_value: number
          rejected: number
          spend: number
          unique_merchants: number
          vat: number
        }[]
      }
      pi_norm_doc_number: { Args: { _raw: string }; Returns: string }
      pi_norm_tax_id: { Args: { _raw: string }; Returns: string }
      pi_pending_ageing: {
        Args: never
        Returns: {
          bucket: string
          invoice_count: number
          value: number
        }[]
      }
      pi_search_invoices: {
        Args: { _limit?: number; _offset?: number; _q: string }
        Returns: {
          approval_status: string
          buyer_name: string
          currency: string
          hotel_id: string
          id: string
          invoice_date: string
          invoice_number: string
          merchant_name: string
          merchant_tax_id: string
          rank: number
          review_status: string
          status: string
          total_amount: number
        }[]
      }
      pi_user_hotel: { Args: never; Returns: string }
      pi_user_org: { Args: never; Returns: string }
      pi_user_role: { Args: never; Returns: string }
      pms_apply_change: {
        Args: {
          p_after: Json
          p_before: Json
          p_business_date: string
          p_event_id?: string
          p_hotel_id: string
          p_room_id: string
        }
        Returns: Json
      }
      purge_old_daily_overview_snapshots: { Args: never; Returns: number }
      purge_revenue_logs: { Args: never; Returns: Json }
      rate_cell_history: {
        Args: {
          p_hotel_id: string
          p_per_cell?: number
          p_since: string
          p_stay_date: string
        }
        Returns: {
          action: string
          delta_eur: number
          id: string
          new_rate_eur: number
          notes: string
          old_rate_eur: number
          payload: Json
          performed_at: string
          performed_by: string
          source: string
          stay_date: string
        }[]
      }
      rate_cell_markers: {
        Args: {
          p_from: string
          p_hotel_id: string
          p_limit?: number
          p_offset?: number
          p_since: string
          p_to: string
        }
        Returns: {
          confirmation_status: string
          new_rate_eur: number
          occupancy: number
          old_rate_eur: number
          performed_at: string
          performed_by: string
          requested_price: number
          room_type_name: string
          source: string
          stay_date: string
        }[]
      }
      reconcile_competitor_rates: {
        Args: {
          _competitor_id: string
          _from: string
          _to: string
          _window_hours?: number
        }
        Returns: number
      }
      refresh_revenue_published_payload: {
        Args: {
          _actor_name?: string
          _completed_at?: string
          _hotel_id: string
        }
        Returns: undefined
      }
      release_automation_lock: { Args: { p_hotel: string }; Returns: undefined }
      release_competitor_scan_lease: {
        Args: { _id: string }
        Returns: undefined
      }
      release_own_revenue_sync: {
        Args: { _error?: string; _hotel_id: string }
        Returns: undefined
      }
      release_publisher_lease: { Args: { p_token: string }; Returns: undefined }
      release_publisher_lock: { Args: { p_hotel: string }; Returns: undefined }
      revenue_calendar_snapshots: {
        Args: {
          _from: string
          _hotel_id: string
          _to: string
          _window_start: string
        }
        Returns: {
          adr_eur: number
          captured_at: string
          captured_date: string
          new_bookings: number
          occupancy_pct: number
          revenue_eur: number
          rooms_available: number
          rooms_sold: number
          stay_date: string
        }[]
      }
      revenue_latest_snapshots: {
        Args: { p_from: string; p_hotel_id: string; p_to: string }
        Returns: {
          adr_eur: number
          captured_date: string
          occupancy_pct: number
          revenue_eur: number
          rn: number
          rooms_available: number
          rooms_sold: number
          stay_date: string
        }[]
      }
      revenue_manual_hold_dates: {
        Args: { p_hotel_id: string; p_since: string; p_sources: string[] }
        Returns: {
          performed_at: string
          stay_date: string
        }[]
      }
      revenue_manual_hold_state: {
        Args: { p_hotel_id: string; p_since: string; p_sources: string[] }
        Returns: {
          hold_kind: string
          hold_until: string
          stay_date: string
        }[]
      }
      revenue_pickup_movements: {
        Args: { _from: string; _hotel_id: string; _since: string; _to: string }
        Returns: {
          captured_at: string
          delta: number
          stay_date: string
        }[]
      }
      revenue_portfolio_latest_snapshots: {
        Args: { _from: string; _hotel_ids: string[]; _to: string }
        Returns: {
          adr_eur: number
          hotel_id: string
          occupancy_pct: number
          revenue_eur: number
          rooms_available: number
          rooms_sold: number
          stay_date: string
        }[]
      }
      revenue_seasonal_anchor: {
        Args: { p_hotel_id: string; p_min_samples?: number }
        Returns: {
          anchor_eur: number
          dow: number
          month: number
          samples: number
        }[]
      }
      revenue_sync_wait_state: {
        Args: { _hotel_id: string }
        Returns: {
          last_success_at: string
          scope: string
        }[]
      }
      revenue_trim_by_stay_date: {
        Args: { _arr: Json; _cutoff: string }
        Returns: Json
      }
      revenue_v2_safety_gate: { Args: never; Returns: Json }
      run_auto_signout: { Args: never; Returns: number }
      slnt_venue_visible: {
        Args: { _user_id: string; _venue_id: string }
        Returns: boolean
      }
      soft_delete_user_profile: {
        Args: { p_caller_id?: string; p_target_user_id: string }
        Returns: Json
      }
      update_assignment_type: {
        Args: {
          assignment_id: string
          new_assignment_type: Database["public"]["Enums"]["assignment_type"]
        }
        Returns: Json
      }
      update_user_credentials: {
        Args: {
          p_assigned_hotel?: string
          p_email?: string
          p_full_name?: string
          p_nickname?: string
          p_phone_number?: string
          p_role?: Database["public"]["Enums"]["user_role"]
          p_send_password_reset?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      upsert_assignment_pattern: {
        Args: {
          p_hotel: string
          p_org_slug?: string
          p_room_a: string
          p_room_b: string
        }
        Returns: undefined
      }
      user_can_access_hotel: {
        Args: { _hotel_id: string; _uid: string }
        Returns: boolean
      }
      user_can_view_ticket: { Args: { ticket_id: string }; Returns: boolean }
      user_has_venue_scopes: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      assignment_status:
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "dnd_pending_retry"
      assignment_type:
        | "daily_cleaning"
        | "checkout_cleaning"
        | "maintenance"
        | "deep_cleaning"
      finance_profile:
        | "none"
        | "uploader"
        | "reviewer"
        | "controller"
        | "chief_controller"
        | "management_read"
      rate_change_source:
        | "engine"
        | "manual"
        | "bulk"
        | "previo_push"
        | "autopilot"
      rate_recommendation_status:
        | "pending"
        | "approved"
        | "pushed"
        | "overridden"
        | "expired"
      reservation_status:
        | "pending"
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
        | "no_show"
      revenue_alert_type:
        | "abnormal_pickup"
        | "floor_breached"
        | "engine_error"
        | "pickup_surge"
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
        | "breakfast_staff"
        | "back_office"
        | "supervisor"
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
      assignment_status: [
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
        "dnd_pending_retry",
      ],
      assignment_type: [
        "daily_cleaning",
        "checkout_cleaning",
        "maintenance",
        "deep_cleaning",
      ],
      finance_profile: [
        "none",
        "uploader",
        "reviewer",
        "controller",
        "chief_controller",
        "management_read",
      ],
      rate_change_source: [
        "engine",
        "manual",
        "bulk",
        "previo_push",
        "autopilot",
      ],
      rate_recommendation_status: [
        "pending",
        "approved",
        "pushed",
        "overridden",
        "expired",
      ],
      reservation_status: [
        "pending",
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
        "no_show",
      ],
      revenue_alert_type: [
        "abnormal_pickup",
        "floor_breached",
        "engine_error",
        "pickup_surge",
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
        "breakfast_staff",
        "back_office",
        "supervisor",
      ],
    },
  },
} as const
