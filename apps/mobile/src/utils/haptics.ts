import * as Haptics from "expo-haptics";

export const hapticSave = (): void => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

export const hapticCelebrate = (): void => {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

export const hapticMilestone = (): void => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
};

export const hapticWarning = (): void => {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
};

export const hapticCritical = (): void => {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
