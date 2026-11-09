<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import LoadingBlock from './components/LoadingBlock.vue';
import { startSession, stopSession, sessionState } from './stores/session';
import Login from './views/auth/Login.vue';
import ResetPassword from './views/auth/ResetPassword.vue';

const route = useRoute();
onMounted(startSession);
onBeforeUnmount(stopSession);
</script>

<template>
  <RouterView v-if="route.meta.public" />
  <LoadingBlock v-else-if="!sessionState.authChecked" full />
  <ResetPassword v-else-if="sessionState.passwordRecovery" />
  <Login v-else-if="!sessionState.session" />
  <LoadingBlock v-else-if="sessionState.accessLoading" full />
  <RouterView v-else />
</template>
