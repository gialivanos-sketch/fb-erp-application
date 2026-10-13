// ============================================================
// Hand-written to match supabase/schema.sql exactly. If you add
// or change a column there, update the matching type here too —
// or once your Supabase project is live, regenerate this file
// automatically with:
//
//   npx supabase gen types typescript --project-id <your-ref> > src/lib/database.types.ts
//
// which reads your project's real schema and never drifts out of
// sync, unlike this hand-written version.
// ============================================================

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          name: string;
          email: string;
          role: "admin" | "chef" | "storekeeper";
          is_active: boolean;
          last_login_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          email: string;
          role?: "admin" | "chef" | "storekeeper";
          is_active?: boolean;
          last_login_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: number;
          name: string;
          name_en: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          address: string | null;
          category: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          name_en?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          address?: string | null;
          category?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["suppliers"]["Insert"]>;
        Relationships: [];
      };
      supplier_products: {
        Row: {
          id: number;
          supplier_id: number;
          product_name: string;
          product_name_en: string | null;
          category: string;
          unit: string;
          base_price: number;
          quality_grade: string | null;
          region_of_origin: string | null;
          is_contract_price: boolean | null;
          is_active: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          supplier_id: number;
          product_name: string;
          product_name_en?: string | null;
          category?: string;
          unit?: string;
          base_price?: number;
          quality_grade?: string | null;
          region_of_origin?: string | null;
          is_contract_price?: boolean | null;
          is_active?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["supplier_products"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: number;
          order_number: string;
          supplier_id: number;
          order_date: string;
          invoice_number: string | null;
          delivery_note_number: string | null;
          notes: string | null;
          status: "draft" | "confirmed" | "delivered" | "cancelled";
          total_net: number;
          total_vat: number;
          total_gross: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          order_number: string;
          supplier_id: number;
          order_date?: string;
          invoice_number?: string | null;
          delivery_note_number?: string | null;
          notes?: string | null;
          status?: "draft" | "confirmed" | "delivered" | "cancelled";
          total_net?: number;
          total_vat?: number;
          total_gross?: number;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: number;
          order_id: number;
          supplier_product_id: number | null;
          product_name: string;
          ordered_quantity: number;
          delivered_quantity: number | null;
          unit: string;
          base_price: number;
          vat_percent: number;
          discount_percent: number;
          net_amount: number;
          vat_amount: number;
          gross_amount: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          order_id: number;
          supplier_product_id?: number | null;
          product_name: string;
          ordered_quantity?: number;
          delivered_quantity?: number | null;
          unit?: string;
          base_price?: number;
          vat_percent?: number;
          discount_percent?: number;
          net_amount?: number;
          vat_amount?: number;
          gross_amount?: number;
        };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
        Relationships: [];
      };
      supplier_payments: {
        Row: {
          id: number;
          supplier_id: number;
          transaction_date: string;
          amount: number;
          type: "debit" | "payment";
          reference: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          supplier_id: number;
          transaction_date?: string;
          amount?: number;
          type: "debit" | "payment";
          reference?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["supplier_payments"]["Insert"]>;
        Relationships: [];
      };
      stock_takings: {
        Row: {
          id: number;
          taking_date: string;
          notes: string | null;
          total_recorded_value: number;
          total_purchase_value: number;
          total_quantity_bought: number;
          distinct_sku_count: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          taking_date?: string;
          notes?: string | null;
          total_recorded_value?: number;
          total_purchase_value?: number;
          total_quantity_bought?: number;
          distinct_sku_count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["stock_takings"]["Insert"]>;
        Relationships: [];
      };
      stock_taking_items: {
        Row: {
          id: number;
          stock_taking_id: number;
          product_name: string;
          initial_stock: number;
          supplier: string | null;
          last_purchase_date: string | null;
          price: number;
          unit: string;
          manual_count: number | null;
          inventory_value: number;
          variance: number;
        };
        Insert: {
          id?: number;
          stock_taking_id: number;
          product_name: string;
          initial_stock?: number;
          supplier?: string | null;
          last_purchase_date?: string | null;
          price?: number;
          unit?: string;
          manual_count?: number | null;
          inventory_value?: number;
          variance?: number;
        };
        Update: Partial<Database["public"]["Tables"]["stock_taking_items"]["Insert"]>;
        Relationships: [];
      };
      inventory_snapshots: {
        Row: {
          id: number;
          snapshot_date: string;
          month_label: string | null;
          recorded_value: number;
          previous_value: number;
          delta_variance: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          snapshot_date?: string;
          month_label?: string | null;
          recorded_value?: number;
          previous_value?: number;
          delta_variance?: number;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["inventory_snapshots"]["Insert"]>;
        Relationships: [];
      };
      ingredients: {
        Row: {
          id: number;
          sku: string;
          name: string;
          name_en: string | null;
          current_stock: number;
          unit: string;
          base_price: number;
          conversion_factor: number;
          conversion_per_unit: string | null;
          mapped_supplier_product_id: number | null;
          wastage_factor: number;
          calories: number;
          is_active: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          sku: string;
          name: string;
          name_en?: string | null;
          current_stock?: number;
          unit?: string;
          base_price?: number;
          conversion_factor?: number;
          conversion_per_unit?: string | null;
          mapped_supplier_product_id?: number | null;
          wastage_factor?: number;
          calories?: number;
          is_active?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["ingredients"]["Insert"]>;
        Relationships: [];
      };
      recipes: {
        Row: {
          id: number;
          name: string;
          name_en: string | null;
          portion_yield: number;
          portion_unit: string;
          allergens: string[];
          plating_images: string[] | null;
          technical_guide: string | null;
          total_raw_material_cost: number;
          labor_cost: number;
          overhead_cost: number;
          total_cost: number;
          profit_margin_percent: number;
          selling_price: number;
          menu_price_vat: number;
          menu_price_final: number;
          is_active: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          name_en?: string | null;
          portion_yield?: number;
          portion_unit?: string;
          allergens?: string[];
          plating_images?: string[] | null;
          technical_guide?: string | null;
          total_raw_material_cost?: number;
          labor_cost?: number;
          overhead_cost?: number;
          total_cost?: number;
          profit_margin_percent?: number;
          selling_price?: number;
          menu_price_vat?: number;
          menu_price_final?: number;
          is_active?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["recipes"]["Insert"]>;
        Relationships: [];
      };
      recipe_ingredients: {
        Row: {
          id: number;
          recipe_id: number;
          ingredient_id: number | null;
          ingredient_name: string;
          quantity: number;
          unit: string;
          unit_cost: number;
          total_cost: number;
          wastage_factor: number;
          requires_prep: boolean;
          prep_notes: string | null;
        };
        Insert: {
          id?: number;
          recipe_id: number;
          ingredient_id?: number | null;
          ingredient_name: string;
          quantity?: number;
          unit?: string;
          unit_cost?: number;
          total_cost?: number;
          wastage_factor?: number;
          requires_prep?: boolean;
          prep_notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["recipe_ingredients"]["Insert"]>;
        Relationships: [];
      };
      menus: {
        Row: {
          id: number;
          title: string;
          title_en: string | null;
          status: "active" | "archived" | "draft";
          total_recipes: number;
          total_portions: number;
          avg_profit_margin: number;
          total_food_cost: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          title: string;
          title_en?: string | null;
          status?: "active" | "archived" | "draft";
          total_recipes?: number;
          total_portions?: number;
          avg_profit_margin?: number;
          total_food_cost?: number;
        };
        Update: Partial<Database["public"]["Tables"]["menus"]["Insert"]>;
        Relationships: [];
      };
      menu_recipes: {
        Row: {
          id: number;
          menu_id: number;
          recipe_id: number | null;
          recipe_name: string;
          portions: number;
          food_cost: number;
          selling_price: number;
          profit_margin: number;
        };
        Insert: {
          id?: number;
          menu_id: number;
          recipe_id?: number | null;
          recipe_name: string;
          portions?: number;
          food_cost?: number;
          selling_price?: number;
          profit_margin?: number;
        };
        Update: Partial<Database["public"]["Tables"]["menu_recipes"]["Insert"]>;
        Relationships: [];
      };
      prep_lists: {
        Row: {
          id: number;
          menu_id: number | null;
          recipe_name: string;
          ingredient_name: string;
          quantity_needed: number;
          unit: string;
          is_prepped: boolean;
          manual_override: number | null;
          portion_calculation: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          menu_id?: number | null;
          recipe_name: string;
          ingredient_name: string;
          quantity_needed?: number;
          unit?: string;
          is_prepped?: boolean;
          manual_override?: number | null;
          portion_calculation?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["prep_lists"]["Insert"]>;
        Relationships: [];
      };
      units: {
        Row: {
          id: number;
          name: string;
          name_en: string | null;
          abbreviation: string;
          base_unit: string | null;
          conversion_factor: number;
          description: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          name_en?: string | null;
          abbreviation: string;
          base_unit?: string | null;
          conversion_factor?: number;
          description?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["units"]["Insert"]>;
        Relationships: [];
      };
      ingestion_logs: {
        Row: {
          id: number;
          file_name: string;
          file_type: string;
          records_parsed: number;
          records_inserted: number;
          status: string;
          errors: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          file_name: string;
          file_type: string;
          records_parsed?: number;
          records_inserted?: number;
          status?: string;
          errors?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ingestion_logs"]["Insert"]>;
        Relationships: [];
      };
    };
    // Required by Supabase's GenericSchema constraint even when empty —
    // omitting these caused every table query in this file to silently
    // degrade to a `never` type instead of failing clearly, which is
    // exactly what was happening before this was added.
    Views: Record<string, never>;
    Functions: {
      // Matches get_ingredient_current_price() in schema_dynamic_pricing.sql —
      // returns table(...), so Returns is an array of rows here, one row
      // per match (in practice always 0 or 1 row for this specific function).
      get_ingredient_current_price: {
        Args: { p_ingredient_id: number };
        Returns: {
          unit_cost: number;
          unit: string;
          price_source: string;
          source_detail: string | null;
        }[];
      };
    };
  };
}
