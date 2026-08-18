import { ref } from 'vue'
import { mockChannels } from '../data/mock'
import type { ChannelSummary } from '../types/models'

const selectedChannel = ref<ChannelSummary>(mockChannels.find((channel) => channel.active) ?? mockChannels[0])

function selectChannel(channel: ChannelSummary) {
  selectedChannel.value = channel
}

export function useChannel() {
  return { selectedChannel, selectChannel }
}
