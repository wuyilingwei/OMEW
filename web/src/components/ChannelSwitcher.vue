<script setup lang="ts">
import { computed } from 'vue'
import { WinDropDownButton } from '../vendor/winui'
import type { ChannelSummary } from '../types/models'

const props = defineProps<{ channels: ChannelSummary[]; modelValue: ChannelSummary }>()
const emit = defineEmits<{ 'update:modelValue': [ChannelSummary] }>()

const flyoutItems = computed(() =>
  props.channels.map((channel) => ({ Text: channel.name, Value: channel.id, channel })),
)

function onSelect(item: { channel: ChannelSummary }) {
  emit('update:modelValue', item.channel)
}
</script>

<template>
  <WinDropDownButton
    class="channel-switcher"
    :Content="modelValue.name"
    :Flyout="{ Items: flyoutItems }"
    @Select="onSelect"
  />
</template>

<style scoped>
.channel-switcher {
  font-weight: 600;
}
</style>
