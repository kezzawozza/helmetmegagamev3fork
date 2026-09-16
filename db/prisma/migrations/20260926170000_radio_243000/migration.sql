-- The 243.000 radio net: the Tribunal's own frequency, a third special
-- channel under the shared "radio" category. See db/lib/specialChannels.js.
ALTER TABLE "GameConfig" ADD COLUMN "freq243000ChannelId" TEXT;
