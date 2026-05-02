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
          created_at: string
          decrease_interval_hours: number
          engine_uses_room_setup: boolean
          floor_price_eur: number
          hotel_id: string
          is_engine_enabled: boolean
          max_daily_change_eur: number
          notify_email: string[]
          notify_on: Json
          notify_sms: string[]
          organization_slug: string
          pickup_increase_tiers: Json
          skip_within_days: number
          updated_at: string
          weekday_decrease_eur: number
          weekend_decrease_eur: number
        }
        Insert: {
          abnormal_pickup_threshold?: number
          created_at?: string
          decrease_interval_hours?: number
          engine_uses_room_setup?: boolean
          floor_price_eur?: number
          hotel_id: string
          is_engine_enabled?: boolean
          max_daily_change_eur?: number
          notify_email?: string[]
          notify_on?: Json
          notify_sms?: string[]
          organization_slug: string
          pickup_increase_tiers?: Json
          skip_within_days?: number
          updated_at?: string
          weekday_decrease_eur?: number
          weekend_decrease_eur?: number
        }
        Update: {
          abnormal_pickup_threshold?: number
          created_at?: string
          decrease_interval_hours?: number
          engine_uses_room_setup?: boolean
          floor_price_eur?: number
          hotel_id?: string
          is_engine_enabled?: boolean
          max_daily_change_eur?: number
          notify_email?: string[]
          notify_on?: Json
          notify_sms?: string[]
          organization_slug?: string
          pickup_increase_tiers?: Json
          skip_within_days?: number
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
      pms_configurations: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          pms_hotel_id: string
          pms_type: string
          settings: Json | null
          sync_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          pms_hotel_id: string
          pms_type?: string
          settings?: Json | null
          sync_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          pms_hotel_id?: string
          pms_type?: string
          settings?: Json | null
          sync_enabled?: boolean
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
          created_at: string
          hotelcare_room_number: string
          id: string
          is_active: boolean
          pms_config_id: string
          pms_room_id: string
          pms_room_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hotelcare_room_number: string
          id?: string
          is_active?: boolean
          pms_config_id: string
          pms_room_id: string
          pms_room_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hotelcare_room_number?: string
          id?: string
          is_active?: boolean
          pms_config_id?: string
          pms_room_id?: string
          pms_room_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_room_mappings_pms_config_id_fkey"
            columns: ["pms_config_id"]
            isOneToOne: false
            referencedRelation: "pms_configurations"
            referencedColumns: ["id"]
          },
        ]
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
      profiles: {
        Row: {
          assigned_hotel: string | null
          created_at: string | null
          email: string
          full_name: string
          hotel_id: string | null
          id: string
          is_super_admin: boolean | null
          last_login: string | null
          nickname: string | null
          organization_slug: string | null
          phone_number: string | null
          preferred_language: string | null
          profile_picture_url: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string | null
        }
        Insert: {
          assigned_hotel?: string | null
          created_at?: string | null
          email: string
          full_name: string
          hotel_id?: string | null
          id: string
          is_super_admin?: boolean | null
          last_login?: string | null
          nickname?: string | null
          organization_slug?: string | null
          phone_number?: string | null
          preferred_language?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Update: {
          assigned_hotel?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          hotel_id?: string | null
          id?: string
          is_super_admin?: boolean | null
          last_login?: string | null
          nickname?: string | null
          organization_slug?: string | null
          phone_number?: string | null
          preferred_language?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Relationships: []
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
          created_at: string
          current_rate_eur: number | null
          delta_eur: number
          hotel_id: string
          id: string
          organization_slug: string
          pushed_at: string | null
          reason: string | null
          recommended_rate_eur: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["rate_recommendation_status"]
          stay_date: string
        }
        Insert: {
          created_at?: string
          current_rate_eur?: number | null
          delta_eur: number
          hotel_id: string
          id?: string
          organization_slug: string
          pushed_at?: string | null
          reason?: string | null
          recommended_rate_eur: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["rate_recommendation_status"]
          stay_date: string
        }
        Update: {
          created_at?: string
          current_rate_eur?: number | null
          delta_eur?: number
          hotel_id?: string
          id?: string
          organization_slug?: string
          pushed_at?: string | null
          reason?: string | null
          recommended_rate_eur?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          dnd_marked_at: string | null
          dnd_marked_by: string | null
          estimated_duration: number | null
          id: string
          is_dnd: boolean | null
          notes: string | null
          organization_slug: string | null
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
          dnd_marked_at?: string | null
          dnd_marked_by?: string | null
          estimated_duration?: number | null
          id?: string
          is_dnd?: boolean | null
          notes?: string | null
          organization_slug?: string | null
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
          dnd_marked_at?: string | null
          dnd_marked_by?: string | null
          estimated_duration?: number | null
          id?: string
          is_dnd?: boolean | null
          notes?: string | null
          organization_slug?: string | null
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
          created_at: string
          derivation_mode: string
          derivation_value: number
          hotel_id: string
          id: string
          is_reference: boolean
          max_price_eur: number
          min_price_eur: number
          name: string
          num_rooms: number
          organization_slug: string
          pms_rate_id: string | null
          pms_room_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          base_price_eur?: number
          created_at?: string
          derivation_mode?: string
          derivation_value?: number
          hotel_id: string
          id?: string
          is_reference?: boolean
          max_price_eur?: number
          min_price_eur?: number
          name: string
          num_rooms?: number
          organization_slug: string
          pms_rate_id?: string | null
          pms_room_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          base_price_eur?: number
          created_at?: string
          derivation_mode?: string
          derivation_value?: number
          hotel_id?: string
          id?: string
          is_reference?: boolean
          max_price_eur?: number
          min_price_eur?: number
          name?: string
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
          room_capacity: number | null
          room_category: string | null
          room_name: string | null
          room_number: string
          room_size_sqm: number | null
          room_type: string | null
          status: string | null
          towel_change_required: boolean | null
          updated_at: string
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
          room_capacity?: number | null
          room_category?: string | null
          room_name?: string | null
          room_number: string
          room_size_sqm?: number | null
          room_type?: string | null
          status?: string | null
          towel_change_required?: boolean | null
          updated_at?: string
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
          room_capacity?: number | null
          room_category?: string | null
          room_name?: string | null
          room_number?: string
          room_size_sqm?: number | null
          room_type?: string | null
          status?: string | null
          towel_change_required?: boolean | null
          updated_at?: string
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
          guide_id: string
          highlight_padding: number | null
          id: string
          position: string | null
          requires_action: boolean | null
          step_key: string
          step_order: number
          target_selector: string | null
        }
        Insert: {
          action_type?: string | null
          created_at?: string | null
          guide_id: string
          highlight_padding?: number | null
          id?: string
          position?: string | null
          requires_action?: boolean | null
          step_key: string
          step_order: number
          target_selector?: string | null
        }
        Update: {
          action_type?: string | null
          created_at?: string | null
          guide_id?: string
          highlight_padding?: number | null
          id?: string
          position?: string | null
          requires_action?: boolean | null
          step_key?: string
          step_order?: number
          target_selector?: string | null
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
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          slug: string
          sort_order: number | null
          target_role: string | null
          total_steps: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          slug: string
          sort_order?: number | null
          target_role?: string | null
          total_steps?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          slug?: string
          sort_order?: number | null
          target_role?: string | null
          total_steps?: number | null
          updated_at?: string | null
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      cleanup_old_photos: { Args: never; Returns: undefined }
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
      has_pms_access: { Args: { user_id: string }; Returns: boolean }
      has_ticket_creation_permission: {
        Args: { _user_id: string }
        Returns: boolean
      }
      is_revenue_user: { Args: { _uid: string }; Returns: boolean }
      is_super_admin: { Args: { user_id: string }; Returns: boolean }
      normalize_hotel_name: { Args: { input_hotel: string }; Returns: string }
      organization_has_custom_branding: {
        Args: { org_slug: string }
        Returns: boolean
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
      user_can_view_ticket: { Args: { ticket_id: string }; Returns: boolean }
    }
    Enums: {
      assignment_status: "assigned" | "in_progress" | "completed" | "cancelled"
      assignment_type:
        | "daily_cleaning"
        | "checkout_cleaning"
        | "maintenance"
        | "deep_cleaning"
      rate_change_source: "engine" | "manual" | "bulk" | "previo_push"
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
      revenue_alert_type: "abnormal_pickup" | "floor_breached" | "engine_error"
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
      rate_change_source: ["engine", "manual", "bulk", "previo_push"],
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
      revenue_alert_type: ["abnormal_pickup", "floor_breached", "engine_error"],
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
