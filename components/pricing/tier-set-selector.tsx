"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Sentinel value for the "New tier set" option (D-17 default/first option).
 * Radix `Select` items require a non-empty string value, so this can never
 * collide with a real `pricing_tier_sets.id` (a `uuid`).
 */
export const NEW_TIER_SET_VALUE = "new";

export interface TierSetSelectorOption {
  id: string;
  effectiveFrom: string;
}

interface TierSetSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  tierSets: TierSetSelectorOption[];
}

/**
 * TierSetSelector — presentational Radix `Select` (D-17) listing
 * `New tier set` first (the default), then one `Effective {date}` entry per
 * existing tier set, most recent first. Radix `Select` scrolls its own
 * viewport internally, so no manual height cap is needed as amended MSA
 * tier sets accumulate (UI-SPEC E6 overflow backstop).
 */
export function TierSetSelector({ value, onValueChange, tierSets }: TierSetSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="tier-set-selector">Tier set</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="tier-set-selector" size="sm" aria-label="Tier set">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NEW_TIER_SET_VALUE}>New tier set</SelectItem>
          {tierSets.map((tierSet) => (
            <SelectItem key={tierSet.id} value={tierSet.id}>
              Effective {tierSet.effectiveFrom}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs font-light text-muted-foreground">
        Choose an existing tier set to correct it in place, or add a new one
        that takes over from its effective date.
      </p>
    </div>
  );
}
