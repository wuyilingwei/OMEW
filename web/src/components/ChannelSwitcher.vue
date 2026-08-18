<script setup lang="ts">
import { computed } from 'vue'
import { mockChannels } from '../data/mock'
import { useChannel } from '../composables/useChannel'
import { useShellView } from '../composables/useShellView'
import { WinDropDownButton } from '../vendor/winui'

const { selectedChannel, selectChannel } = useChannel()
const { setView } = useShellView()

const flyout = computed(() => ({
  Items: mockChannels.map((channel) => ({ Text: channel.name, Value: channel.id })),
}))

function onSelect(item: { Value: string }) {
  const channel = mockChannels.find((candidate) => candidate.id === item.Value)
  if (!channel) return
  selectChannel(channel)
  setView('chat')
}
</script>

<template>
  <WinDropDownButton class="channel-switcher" :Flyout="flyout" @Select="onSelect">
    <span class="channel-switcher__label">{{ selectedChannel.name }}</span>
  </WinDropDownButton>
</template>

<style scoped>
.channel-switcher {
  flex: 0 0 auto;
  font-size: 0.85rem;
}

.channel-switcher__label {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
