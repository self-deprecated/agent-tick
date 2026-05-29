import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { Pressable, Text, View } from "react-native";
import { styles } from "../mobileStyles";

export function ScannerScreen({
  cameraPermission,
  onCancel,
  onRequestPermission,
  onScan,
  scanning,
}: {
  cameraPermission: ReturnType<typeof useCameraPermissions>[0];
  onCancel: () => void;
  onRequestPermission: () => void;
  onScan: (result: BarcodeScanningResult) => void;
  scanning: boolean;
}) {
  if (!cameraPermission?.granted) {
    return (
      <View style={styles.waitingPane}>
        <Text style={styles.waitingTitle}>Camera Access</Text>
        <Pressable onPress={onRequestPermission} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Enable Camera</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.scannerPane}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanning ? undefined : onScan}
        style={styles.scanner}
      />
      <View style={styles.scannerFooter}>
        <Pressable onPress={onCancel} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
