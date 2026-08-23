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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      apigee_calls: {
        Row: {
          endpoint_category: string | null
          event_time: string
          external_card_reference: string | null
          id: number
          raw_event_time: string
          raw_path_suffix: string
          response_code: number
          row_hash: string | null
          source_file_id: string
        }
        Insert: {
          endpoint_category?: string | null
          event_time: string
          external_card_reference?: string | null
          id?: never
          raw_event_time: string
          raw_path_suffix: string
          response_code: number
          row_hash?: string | null
          source_file_id: string
        }
        Update: {
          endpoint_category?: string | null
          event_time?: string
          external_card_reference?: string | null
          id?: never
          raw_event_time?: string
          raw_path_suffix?: string
          response_code?: number
          row_hash?: string | null
          source_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apigee_calls_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "ingested_files"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_transactions: {
        Row: {
          authorised: boolean
          event_time: string
          id: number
          issuer_bank: string
          processor: string
          raw_transaction_date: string
          raw_transaction_time: string
          region: string
          source_file_id: string
          token_reference: string
          transaction_id: string
          verification_kind: string
        }
        Insert: {
          authorised: boolean
          event_time: string
          id?: never
          issuer_bank: string
          processor: string
          raw_transaction_date: string
          raw_transaction_time: string
          region: string
          source_file_id: string
          token_reference: string
          transaction_id: string
          verification_kind: string
        }
        Update: {
          authorised?: boolean
          event_time?: string
          id?: never
          issuer_bank?: string
          processor?: string
          raw_transaction_date?: string
          raw_transaction_time?: string
          region?: string
          source_file_id?: string
          token_reference?: string
          transaction_id?: string
          verification_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_transactions_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "ingested_files"
            referencedColumns: ["id"]
          },
        ]
      }
      card_inventory: {
        Row: {
          created_at: string
          external_card_reference: string
          id: number
          raw_created_at: string
          report_date: string
          source_file_id: string
        }
        Insert: {
          created_at: string
          external_card_reference: string
          id?: never
          raw_created_at: string
          report_date: string
          source_file_id: string
        }
        Update: {
          created_at?: string
          external_card_reference?: string
          id?: never
          raw_created_at?: string
          report_date?: string
          source_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_inventory_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "ingested_files"
            referencedColumns: ["id"]
          },
        ]
      }
      dcvv_fetches: {
        Row: {
          duration_ms: number
          external_reference: string
          id: number
          raw_timestamp: string
          row_hash: string | null
          source_file_id: string
          timestamp: string
        }
        Insert: {
          duration_ms: number
          external_reference: string
          id?: never
          raw_timestamp: string
          row_hash?: string | null
          source_file_id: string
          timestamp: string
        }
        Update: {
          duration_ms?: number
          external_reference?: string
          id?: never
          raw_timestamp?: string
          row_hash?: string | null
          source_file_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "dcvv_fetches_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "ingested_files"
            referencedColumns: ["id"]
          },
        ]
      }
      ingested_files: {
        Row: {
          content_sha256: string
          file_name: string
          id: string
          reject_reasons: Json | null
          report_type: string | null
          rows_accepted: number | null
          rows_duplicate: number | null
          rows_excluded: number | null
          rows_rejected: number | null
          status: string
          storage_path: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          content_sha256: string
          file_name: string
          id?: string
          reject_reasons?: Json | null
          report_type?: string | null
          rows_accepted?: number | null
          rows_duplicate?: number | null
          rows_excluded?: number | null
          rows_rejected?: number | null
          status?: string
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          content_sha256?: string
          file_name?: string
          id?: string
          reject_reasons?: Json | null
          report_type?: string | null
          rows_accepted?: number | null
          rows_duplicate?: number | null
          rows_excluded?: number | null
          rows_rejected?: number | null
          status?: string
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      pricing_tier_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          summary: string
          tier_set_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          summary: string
          tier_set_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          summary?: string
          tier_set_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_tier_audit_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "pricing_tier_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_tier_audit_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_by_tier"
            referencedColumns: ["tier_set_id"]
          },
          {
            foreignKeyName: "pricing_tier_audit_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_tier_set_by_day"
            referencedColumns: ["tier_set_id"]
          },
          {
            foreignKeyName: "pricing_tier_audit_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_window_counts"
            referencedColumns: ["tier_set_id"]
          },
        ]
      }
      pricing_tier_sets: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          reset_window: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          reset_window: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          reset_window?: string
        }
        Relationships: []
      }
      pricing_tiers: {
        Row: {
          id: number
          rate: number
          tier_order: number
          tier_set_id: string
          upper_bound: number | null
        }
        Insert: {
          id?: never
          rate: number
          tier_order: number
          tier_set_id: string
          upper_bound?: number | null
        }
        Update: {
          id?: never
          rate?: number
          tier_order?: number
          tier_set_id?: string
          upper_bound?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_tiers_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "pricing_tier_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_tiers_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_by_tier"
            referencedColumns: ["tier_set_id"]
          },
          {
            foreignKeyName: "pricing_tiers_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_tier_set_by_day"
            referencedColumns: ["tier_set_id"]
          },
          {
            foreignKeyName: "pricing_tiers_tier_set_id_fkey"
            columns: ["tier_set_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_window_counts"
            referencedColumns: ["tier_set_id"]
          },
        ]
      }
      removed_cards: {
        Row: {
          external_card_reference: string
          id: number
          raw_removed_at: string
          removed_at: string
          row_hash: string | null
          source_file_id: string
        }
        Insert: {
          external_card_reference: string
          id?: never
          raw_removed_at: string
          removed_at: string
          row_hash?: string | null
          source_file_id: string
        }
        Update: {
          external_card_reference?: string
          id?: never
          raw_removed_at?: string
          removed_at?: string
          row_hash?: string | null
          source_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "removed_cards_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "ingested_files"
            referencedColumns: ["id"]
          },
        ]
      }
      verifications: {
        Row: {
          authenticated: boolean
          created_at: string
          cvi2_value: number
          duration_ms: number
          external_card_reference: string
          id: number
          raw_created_at: string
          row_hash: string | null
          source_file_id: string
        }
        Insert: {
          authenticated: boolean
          created_at: string
          cvi2_value: number
          duration_ms: number
          external_card_reference: string
          id?: never
          raw_created_at: string
          row_hash?: string | null
          source_file_id: string
        }
        Update: {
          authenticated?: boolean
          created_at?: string
          cvi2_value?: number
          duration_ms?: number
          external_card_reference?: string
          id?: never
          raw_created_at?: string
          row_hash?: string | null
          source_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verifications_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "ingested_files"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_apigee_cross_check: {
        Row: {
          apigee_count: number | null
          day_utc: string | null
          endpoint_category: string | null
          error_500_count: number | null
          mapped_count: number | null
          mapped_metric: string | null
          status: string | null
        }
        Relationships: []
      }
      v_billing_daily_counts: {
        Row: {
          billing_count: number | null
          day_utc: string | null
        }
        Relationships: []
      }
      v_inventory_daily_diff: {
        Row: {
          day: string | null
          enrolled_count: number | null
          unenrolled_count: number | null
        }
        Relationships: []
      }
      v_inventory_gap_days: {
        Row: {
          missing_day: string | null
        }
        Relationships: []
      }
      v_inventory_live_count: {
        Row: {
          live_count: number | null
        }
        Relationships: []
      }
      v_reconciliation_billing_daily: {
        Row: {
          billing_count: number | null
          day_utc: string | null
          delta: number | null
          settled: boolean | null
          short_side: string | null
          status: string | null
          verification_count: number | null
        }
        Relationships: []
      }
      v_reconciliation_inventory_daily: {
        Row: {
          day: string | null
          delta: number | null
          enrolled_count: number | null
          removed_count: number | null
          short_side: string | null
          status: string | null
          unenrolled_count: number | null
        }
        Relationships: []
      }
      v_revenue_by_tier: {
        Row: {
          day_utc: string | null
          overlap_count: number | null
          rate: number | null
          tier_order: number | null
          tier_revenue: number | null
          tier_set_id: string | null
        }
        Relationships: []
      }
      v_revenue_daily: {
        Row: {
          day_utc: string | null
          revenue: number | null
        }
        Relationships: []
      }
      v_revenue_daily_counts: {
        Row: {
          day_utc: string | null
          verification_count: number | null
        }
        Relationships: []
      }
      v_revenue_tier_set_by_day: {
        Row: {
          day_utc: string | null
          reset_window: string | null
          tier_set_id: string | null
          verification_count: number | null
        }
        Relationships: []
      }
      v_revenue_total: {
        Row: {
          total_revenue: number | null
        }
        Relationships: []
      }
      v_revenue_window_counts: {
        Row: {
          c_before: number | null
          day_utc: string | null
          reset_window: string | null
          tier_set_id: string | null
          verification_count: number | null
          window_start: string | null
        }
        Relationships: []
      }
      v_sla_breaches: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          external_card_reference: string | null
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          external_card_reference?: string | null
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          external_card_reference?: string | null
        }
        Relationships: []
      }
      v_sla_daily: {
        Row: {
          avg_duration_ms: number | null
          breach_count: number | null
          day_utc: string | null
        }
        Relationships: []
      }
      v_verifications_daily: {
        Row: {
          authenticated_count: number | null
          day_utc: string | null
          failed_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      delete_latest_pricing_tier_set: {
        Args: { p_tier_set_id: string }
        Returns: undefined
      }
      save_pricing_tier_set: {
        Args: {
          p_effective_from: string
          p_reset_window: string
          p_tiers: Json
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
