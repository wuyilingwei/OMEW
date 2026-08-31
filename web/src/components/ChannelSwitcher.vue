<script setup lang="ts">
import { computed } from 'vue'
import { useChannel } from '../composables/useChannel'
import { useShellView } from '../composables/useShellView'
import { WinDropDownButton } from '../vendor/winui'

const { channelRooms, selectedChannel, selectChannel } = useChannel()
const { setView } = useShellView()

const flyout = computed(() => ({
  Items: channelRooms.value.map((room) => ({ Text: room.name, Value: room.id })),
}))

function onSelect(item: { Value: string }) {
  const room = channelRooms.value.find((candidate) => candidate.id === item.Value)
  if (!room) return
  selectChannel(room)
  setView('chat')
}
</script>

<template>
  <WinDropDownButton class="channel-switcher" :Flyout="flyout" @select="onSelect">
    <span class="channel-switcher__label">{{ selectedChannel?.name ?? '无话题' }}</span>
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
