package org.streamingsoftware.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

/**
 * Declaring CAMERA/RECORD_AUDIO in the manifest is not enough on Android 6+.
 * Capacitor's WebChromeClient only grants a getUserMedia() request when the
 * matching runtime permission is already held, so without this the preview
 * silently stays black.
 */
public class MainActivity extends BridgeActivity {

    private static final int MEDIA_PERMISSIONS_REQUEST = 4711;

    private static final String[] REQUIRED_PERMISSIONS = new String[] {
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestMediaPermissions();
    }

    private void requestMediaPermissions() {
        List<String> missing = new ArrayList<>();
        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission)
                    != PackageManager.PERMISSION_GRANTED) {
                missing.add(permission);
            }
        }
        if (!missing.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                missing.toArray(new String[0]),
                MEDIA_PERMISSIONS_REQUEST
            );
        }
    }
}
