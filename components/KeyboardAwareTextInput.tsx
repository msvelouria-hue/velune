
import React from 'react';
import { TextInput, TextInputProps } from 'react-native';

interface KeyboardAwareTextInputProps extends TextInputProps {
  // Add any custom props if needed
}

export const KeyboardAwareTextInput: React.FC<KeyboardAwareTextInputProps> = ({
  multiline,
  ...props
}) => {
  return (
    <TextInput
      {...props}
      multiline={multiline}
      textAlignVertical={multiline ? "top" : undefined}
      scrollEnabled={multiline ? false : undefined}
      blurOnSubmit={multiline ? false : true}
    />
  );
};
