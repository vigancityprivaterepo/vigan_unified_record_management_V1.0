-- Marks a program whose records are assistance given to a person (AICS,
-- farm inputs, relief): each record then counts as one release on the
-- Assistance page (services/assistance.ts), which adds them up per household
-- across offices. assistance_amount_key names the program's NUMBER field
-- holding the value in pesos; null when the program records no amount.
ALTER TABLE "office_module"
  ADD COLUMN "gives_assistance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "assistance_amount_key" TEXT;
